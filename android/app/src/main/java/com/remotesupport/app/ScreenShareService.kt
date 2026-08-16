package com.remotesupport.app

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.concurrent.TimeUnit

class ScreenShareService : Service() {

    companion object {
        private const val TAG = "ScreenShareService"
        const val EXTRA_SESSION_ID = "session_id"
        const val EXTRA_PAIRING_TOKEN = "pairing_token"
        const val EXTRA_RESULT_DATA = "result_data"
        const val EXTRA_OPERATOR_NAME = "operator_name"
        private const val CHANNEL_ID = "screen_share_channel"
        private const val NOTIFICATION_ID = 1001
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var signalingJob: Job? = null

    private lateinit var mediaProjectionManager: MediaProjectionManager
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var screenCapturer: ScreenCapturerAndroid? = null

    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var eglBase: EglBase? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null

    private var webSocket: WebSocket? = null
    private var sessionId: String? = null
    private var pairingToken: String? = null
    private var operatorName: String? = null
    private var iceServers: List<PeerConnection.IceServer> = emptyList()

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    override fun onCreate() {
        super.onCreate()
        mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        createNotificationChannel()
        initializeWebRTC()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) return START_NOT_STICKY

        sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
        pairingToken = intent.getStringExtra(EXTRA_PAIRING_TOKEN)
        operatorName = intent.getStringExtra(EXTRA_OPERATOR_NAME) ?: "Support Operator"
        val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }

        if (sessionId == null || pairingToken == null || resultData == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForegroundWithNotification()

        mediaProjection = mediaProjectionManager.getMediaProjection(Activity.RESULT_OK, resultData)
        if (mediaProjection == null) {
            Log.e(TAG, "MediaProjection is null")
            stopSelf()
            return START_NOT_STICKY
        }

        startScreenCapture()
        connectSignaling()

        return START_STICKY
    }

    private fun startForegroundWithNotification() {
        val notification = buildNotification("Screen sharing active")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(text: String): Notification {
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Remote Support")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setOngoing(true)
            .build()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Screen Sharing",
            NotificationManager.IMPORTANCE_LOW
        )
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    private fun initializeWebRTC() {
        val options = PeerConnectionFactory.InitializationOptions.builder(this)
            .setEnableInternalTracer(false)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(options)
        peerConnectionFactory = PeerConnectionFactory.builder()
            .setAudioDeviceModule(JavaAudioDeviceModule.builder(this).createAudioDeviceModule())
            .createPeerConnectionFactory()
        eglBase = EglBase.create()
    }

    private fun startScreenCapture() {
        val projection = mediaProjection ?: return
        val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        windowManager.defaultDisplay.getRealMetrics(metrics)
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val density = metrics.densityDpi

        val factory = peerConnectionFactory ?: return
        videoSource = factory.createVideoSource(false)
        surfaceTextureHelper = SurfaceTextureHelper.create("ScreenCaptureThread", eglBase?.eglBaseContext)
        videoTrack = factory.createVideoTrack("screen0", videoSource)

        // ScreenCapturerAndroid reads frames from the MediaProjection's VirtualDisplay
        // and pushes them into the WebRTC VideoSource. This is the REAL screen stream.
        screenCapturer = ScreenCapturerAndroid(projection, object : MediaProjection.Callback() {
            override fun onStop() {
                Log.i(TAG, "MediaProjection stopped")
                stopSelf()
            }
        })
        screenCapturer?.initialize(surfaceTextureHelper, applicationContext, videoSource!!.capturerObserver)
        screenCapturer?.startCapture(width, height, 30)
    }

    private fun connectSignaling() {
        val sid = sessionId ?: return
        val token = pairingToken ?: return

        signalingJob = serviceScope.launch {
            fetchIceServers()
            val wsUrl = buildWsUrl()
            val request = Request.Builder().url(wsUrl).build()
            webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    Log.i(TAG, "Signaling connected")
                    sendJson(
                        mapOf(
                            "type" to "hello",
                            "role" to "device",
                            "sessionId" to sid,
                            "token" to token
                        )
                    )
                    sendJson(
                        mapOf(
                            "type" to "device_joined",
                            "sessionId" to sid,
                            "deviceInfo" to deviceInfo()
                        )
                    )
                    sendJson(
                        mapOf(
                            "type" to "device_consent_granted",
                            "sessionId" to sid
                        )
                    )
                    sendJson(
                        mapOf(
                            "type" to "device_capture_started",
                            "sessionId" to sid
                        )
                    )
                    createPeerConnection()
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    handleSignalingMessage(text)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    Log.e(TAG, "Signaling failure", t)
                    stopSelf()
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    Log.i(TAG, "Signaling closed: $reason")
                    stopSelf()
                }
            })
        }
    }

    private fun fetchIceServers() {
        try {
            val base = getString(R.string.signaling_base_url)
            val request = Request.Builder().url("$base/api/ice-servers").build()
            okHttpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string()
                    if (body != null) {
                        val json = JSONObject(body)
                        val servers = json.optJSONArray("iceServers") ?: JSONArray()
                        iceServers = buildList {
                            for (i in 0 until servers.length()) {
                                val server = servers.getJSONObject(i)
                                val urls = server.opt("urls")
                                val urlList = when (urls) {
                                    is JSONArray -> buildList {
                                        for (j in 0 until urls.length()) add(urls.getString(j))
                                    }
                                    is String -> listOf(urls)
                                    else -> emptyList()
                                }
                                if (urlList.isNotEmpty()) {
                                    add(
                                        PeerConnection.IceServer.builder(urlList)
                                            .setUsername(server.optString("username", ""))
                                            .setPassword(server.optString("credential", ""))
                                            .createIceServer()
                                    )
                                }
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch ICE servers", e)
        }
    }

    private fun buildWsUrl(): String {
        val base = getString(R.string.signaling_base_url)
        val wsBase = if (base.startsWith("https")) base.replaceFirst("https", "wss") else base.replaceFirst("http", "ws")
        return "$wsBase/ws"
    }

    private fun deviceInfo(): Map<String, String> {
        return mapOf(
            "platform" to "Android ${Build.VERSION.RELEASE}",
            "device_type" to "android",
            "browser" to "native-app",
            "model" to "${Build.MANUFACTURER} ${Build.MODEL}",
            "screen" to "${resources.displayMetrics.widthPixels}x${resources.displayMetrics.heightPixels}",
            "language" to resources.configuration.locales[0].toLanguageTag()
        )
    }

    private fun handleSignalingMessage(text: String) {
        val msg = JSONObject(text)
        when (msg.optString("type")) {
            "answer" -> {
                val sdp = msg.optString("sdp")
                val pc = peerConnection ?: return
                pc.setRemoteDescription(object : SdpObserver {
                    override fun onCreateSuccess(sdp: SessionDescription?) {}
                    override fun onCreateFailure(error: String?) {}
                    override fun onSetSuccess() {}
                    override fun onSetFailure(error: String?) {
                        Log.e(TAG, "setRemoteDescription failed: $error")
                    }
                }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
            }
            "ice" -> {
                val candidate = msg.optJSONObject("candidate")
                if (candidate != null) {
                    val iceCandidate = IceCandidate(
                        candidate.optString("candidate"),
                        candidate.optString("sdpMid"),
                        candidate.optInt("sdpMLineIndex")
                    )
                    peerConnection?.addIceCandidate(iceCandidate)
                }
            }
            "session_ended" -> {
                stopSelf()
            }
            "error" -> {
                Log.e(TAG, "Server error: ${msg.optString("message")}")
                stopSelf()
            }
        }
    }

    private fun sendJson(map: Map<String, Any>) {
        webSocket?.send(JSONObject(map).toString())
    }

    private fun createPeerConnection() {
        val factory = peerConnectionFactory ?: return
        val config = PeerConnection.RTCConfiguration(iceServers)
        config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN

        peerConnection = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                Log.i(TAG, "ICE state: $state")
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidate(candidate: IceCandidate?) {
                if (candidate != null) {
                    sendJson(
                        mapOf(
                            "type" to "ice",
                            "sessionId" to (sessionId ?: ""),
                            "candidate" to mapOf(
                                "candidate" to candidate.sdp,
                                "sdpMid" to candidate.sdpMid,
                                "sdpMLineIndex" to candidate.sdpMLineIndex
                            )
                        )
                    )
                }
            }
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(channel: DataChannel?) {}
            override fun onRenegotiationNeeded() {
                createOffer()
            }
            override fun onAddTrack(receiver: RtpTransceiver?, streams: Array<out MediaStream>?) {}
            override fun onTrack(transceiver: RtpTransceiver?) {}
        })

        val track = videoTrack ?: return
        peerConnection?.addTrack(track, listOf("screen-stream"))
    }

    private fun createOffer() {
        val pc = peerConnection ?: return
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
        }
        pc.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription?) {
                if (sdp != null) {
                    pc.setLocalDescription(this, sdp)
                    sendJson(
                        mapOf(
                            "type" to "offer",
                            "sessionId" to (sessionId ?: ""),
                            "sdp" to sdp.description
                        )
                    )
                }
            }
            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "createOffer failed: $error")
            }
            override fun onSetSuccess() {}
            override fun onSetFailure(error: String?) {
                Log.e(TAG, "setLocalDescription failed: $error")
            }
        }, constraints)
    }

    override fun onDestroy() {
        super.onDestroy()
        signalingJob?.cancel()
        webSocket?.close(1000, "Service destroyed")
        screenCapturer?.stopCapture()
        screenCapturer?.dispose()
        screenCapturer = null
        virtualDisplay?.release()
        virtualDisplay = null
        mediaProjection?.stop()
        mediaProjection = null
        videoTrack?.setEnabled(false)
        videoTrack = null
        videoSource?.dispose()
        videoSource = null
        surfaceTextureHelper?.dispose()
        surfaceTextureHelper = null
        peerConnection?.close()
        peerConnection = null
        peerConnectionFactory?.dispose()
        peerConnectionFactory = null
        eglBase?.release()
        eglBase = null
        serviceScope.cancel()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
package com.remotesupport.app

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.zxing.integration.android.IntentIntegrator
import com.google.zxing.integration.android.IntentResult

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var sessionText: TextView
    private lateinit var scanButton: Button
    private lateinit var allowButton: Button
    private lateinit var stopButton: Button

    private var sessionId: String? = null
    private var pairingToken: String? = null
    private var operatorName: String? = null

    private val mediaProjectionManager by lazy {
        getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    }

    private val projectionPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK && result.data != null) {
                startScreenShare(result.data!!)
            } else {
                statusText.text = "Screen sharing permission was denied."
                allowButton.isEnabled = true
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        sessionText = findViewById(R.id.sessionText)
        scanButton = findViewById(R.id.scanButton)
        allowButton = findViewById(R.id.allowButton)
        stopButton = findViewById(R.id.stopButton)

        val data: Uri? = intent?.data
        if (data != null) {
            parseDeepLink(data)
        } else {
            statusText.text = "Scan a QR code or open a pairing link to begin."
        }

        scanButton.setOnClickListener {
            IntentIntegrator(this)
                .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                .setPrompt("Scan the operator's pairing QR code")
                .setCameraId(0)
                .setBeepEnabled(false)
                .setBarcodeImageEnabled(false)
                .initiateScan()
        }

        allowButton.setOnClickListener {
            requestProjectionPermission()
        }

        stopButton.setOnClickListener {
            stopScreenShare()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val data: Uri? = intent.data
        if (data != null) {
            parseDeepLink(data)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val result: IntentResult? = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (result != null) {
            if (result.contents != null) {
                val uri = Uri.parse(result.contents)
                parseDeepLink(uri)
            } else {
                statusText.text = "QR scan cancelled."
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    private fun parseDeepLink(uri: Uri) {
        val pathSegments = uri.pathSegments
        if (pathSegments.size >= 2 && pathSegments[0] == "pair") {
            sessionId = pathSegments[1]
            pairingToken = uri.getQueryParameter("token")
            operatorName = uri.getQueryParameter("operator") ?: "Support Operator"
            sessionText.text = "Session: $sessionId"
            statusText.text = "$operatorName is requesting to view your screen."
            allowButton.isEnabled = true
        } else {
            statusText.text = "Invalid pairing link."
        }
    }

    private fun requestProjectionPermission() {
        val sid = sessionId ?: run {
            statusText.text = "No session loaded."
            return
        }
        val token = pairingToken ?: run {
            statusText.text = "No pairing token."
            return
        }
        allowButton.isEnabled = false
        statusText.text = "Waiting for Android screen-capture permission…"
        projectionPermissionLauncher.launch(mediaProjectionManager.createScreenCaptureIntent())
    }

    private fun startScreenShare(resultData: Intent) {
        val sid = sessionId ?: return
        val token = pairingToken ?: return
        val serviceIntent = Intent(this, ScreenShareService::class.java).apply {
            putExtra(ScreenShareService.EXTRA_SESSION_ID, sid)
            putExtra(ScreenShareService.EXTRA_PAIRING_TOKEN, token)
            putExtra(ScreenShareService.EXTRA_RESULT_DATA, resultData)
            putExtra(ScreenShareService.EXTRA_OPERATOR_NAME, operatorName ?: "Support Operator")
        }
        ContextCompat.startForegroundService(this, serviceIntent)
        statusText.text = "Screen sharing active. You can stop at any time."
        stopButton.isEnabled = true
    }

    private fun stopScreenShare() {
        val serviceIntent = Intent(this, ScreenShareService::class.java)
        stopService(serviceIntent)
        statusText.text = "Screen sharing stopped."
        stopButton.isEnabled = false
        allowButton.isEnabled = true
    }

    override fun onDestroy() {
        super.onDestroy()
        stopScreenShare()
    }
}
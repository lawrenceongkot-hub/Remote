'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { WsMessage } from '@/lib/types';
import { createPeerConnection, getIceServers, sendWs, wsUrl } from '@/lib/webrtc';

type Phase =
  | 'loading'
  | 'consent'
  | 'requesting_permission'
  | 'sharing'
  | 'denied'
  | 'unsupported'
  | 'ended'
  | 'expired'
  | 'error';

interface PairInfo {
  sessionId: string;
  operatorName: string;
  expiresAt: string;
  status: string;
}

function detectDeviceInfo(): Record<string, string> {
  const ua = navigator.userAgent;
  const platform = navigator.platform || 'unknown';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMobile = isAndroid || isIOS || /Mobi/i.test(ua);
  return {
    platform,
    user_agent: ua.slice(0, 200),
    device_type: isMobile ? (isAndroid ? 'android' : isIOS ? 'ios' : 'mobile') : 'desktop',
    browser: detectBrowser(ua),
    screen: `${window.screen.width}x${window.screen.height}`,
    language: navigator.language,
  };
}

function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Unknown';
}

function supportsScreenCapture(): boolean {
  return typeof navigator !== 'undefined' && 'getDisplayMedia' in navigator.mediaDevices;
}

export default function PairPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const sessionId = params.id;
  const token = searchParams.get('token') ?? '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [pairInfo, setPairInfo] = useState<PairInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<Record<string, string> | null>(null);
  const [iceState, setIceState] = useState<RTCIceConnectionState | 'new'>('new');
  const [pcState, setPcState] = useState<RTCPeerConnectionState | 'new'>('new');

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<Promise<Awaited<ReturnType<typeof getIceServers>>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/pair/${sessionId}`);
        if (res.status === 404) {
          if (!cancelled) {
            setPhase('error');
            setError('Session not found.');
          }
          return;
        }
        if (res.status === 410) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) {
            setPhase(body.error === 'Session expired' ? 'expired' : 'ended');
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled) {
            setPhase('error');
            setError('Failed to load session.');
          }
          return;
        }
        const data: PairInfo = await res.json();
        if (!cancelled) {
          setPairInfo(data);
          setPhase('consent');
        }
      } catch {
        if (!cancelled) {
          setPhase('error');
          setError('Network error while loading session.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const connectSignaling = useCallback(async (): Promise<WebSocket> => {
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });
    sendWs(ws, { type: 'hello', role: 'device', sessionId, token });
    return ws;
  }, [sessionId, token]);

  const startSharing = useCallback(async () => {
    setError(null);

    if (!supportsScreenCapture()) {
      setPhase('unsupported');
      sendWs(wsRef.current!, {
        type: 'device_capture_unsupported',
        sessionId,
        error:
          'This browser does not support screen capture (getDisplayMedia). Mobile browsers (Android Chrome, iOS Safari) do not expose screen capture to web pages. Use the native Android app or a desktop browser.',
      });
      return;
    }

    setPhase('requesting_permission');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Permission denied';
      setPhase('denied');
      sendWs(wsRef.current!, {
        type: 'device_capture_failed',
        sessionId,
        error: `Screen sharing permission was denied: ${message}`,
      });
      return;
    }

    streamRef.current = stream;
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      setPhase('denied');
      sendWs(wsRef.current!, {
        type: 'device_capture_failed',
        sessionId,
        error: 'No video track was provided by the screen capture API.',
      });
      return;
    }

    videoTrack.addEventListener('ended', () => {
      void stopSharing('device');
    });

    sendWs(wsRef.current!, { type: 'device_capture_started', sessionId });

    if (!iceServersRef.current) {
      iceServersRef.current = getIceServers();
    }
    const iceServers = await iceServersRef.current;

    const pc = createPeerConnection(iceServers, {
      onTrack: () => {
        // Device is the sender; no remote tracks expected
      },
      onConnectionStateChange: (state) => {
        setPcState(state);
        if (state === 'connected') {
          sendWs(wsRef.current!, { type: 'peer_connected', sessionId });
        }
        if (state === 'failed') {
          sendWs(wsRef.current!, { type: 'peer_failed', sessionId });
        }
        if (state === 'disconnected' || state === 'closed') {
          sendWs(wsRef.current!, { type: 'peer_disconnected', sessionId });
        }
      },
      onIceConnectionStateChange: (state) => setIceState(state),
      onNegotiationNeeded: () => {
        void (async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendWs(wsRef.current!, { type: 'offer', sessionId, sdp: offer.sdp ?? '' });
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create offer');
          }
        })();
      },
      onError: (err) => setError(err.message),
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWs(wsRef.current!, {
          type: 'ice',
          sessionId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pcRef.current = pc;
    setPhase('sharing');
  }, [sessionId]);

  const stopSharing = useCallback(
    async (reason: 'device' | 'operator' | 'expired') => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (reason === 'device') {
        sendWs(wsRef.current!, { type: 'stop_session', sessionId, reason: 'device' });
      }
      setPhase('ended');
    },
    [sessionId]
  );

  useEffect(() => {
    if (phase !== 'consent') return;
    let ws: WebSocket | null = null;
    let cancelled = false;

    (async () => {
      try {
        ws = await connectSignaling();
        if (cancelled || !ws) return;
        sendWs(ws, { type: 'device_joined', sessionId, deviceInfo: detectDeviceInfo() });
        setDeviceInfo(detectDeviceInfo());
      } catch (err) {
        if (!cancelled) {
          setPhase('error');
          setError(err instanceof Error ? err.message : 'Signaling connection failed');
        }
      }
    })();

    wsRef.current = ws;

    return () => {
      cancelled = true;
    };
  }, [phase, sessionId, connectSignaling]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const onMessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as WsMessage;
      switch (msg.type) {
        case 'answer': {
          const pc = pcRef.current;
          if (!pc) return;
          void pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
          break;
        }
        case 'ice': {
          const pc = pcRef.current;
          if (!pc) return;
          void pc.addIceCandidate(msg.candidate);
          break;
        }
        case 'session_ended':
          void stopSharing(msg.reason);
          break;
        case 'error':
          setError(msg.message);
          break;
      }
    };
    ws.addEventListener('message', onMessage);
    return () => ws.removeEventListener('message', onMessage);
  }, [stopSharing]);

  const cancel = useCallback(() => {
    sendWs(wsRef.current!, { type: 'device_consent_denied', sessionId });
    setPhase('ended');
  }, [sessionId]);

  const isExpired = pairInfo ? new Date(pairInfo.expiresAt).getTime() < Date.now() : false;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-md">
        {phase === 'loading' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
            <p className="text-slate-400">Loading session…</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="rounded-2xl border border-red-800 bg-red-950/50 p-8 text-center">
            <h1 className="mb-2 text-xl font-semibold text-red-300">Error</h1>
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {phase === 'expired' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
            <h1 className="mb-2 text-xl font-semibold">Session Expired</h1>
            <p className="text-sm text-slate-400">
              This support request has expired. Please ask the operator to create a new QR code.
            </p>
          </div>
        )}

        {phase === 'ended' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
            <h1 className="mb-2 text-xl font-semibold">Session Ended</h1>
            <p className="text-sm text-slate-400">
              Screen sharing has ended. You can close this page.
            </p>
          </div>
        )}

        {phase === 'consent' && pairInfo && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
            <h1 className="mb-2 text-2xl font-bold">Remote Support Request</h1>
            <p className="mb-6 text-sm text-slate-400">
              {pairInfo.operatorName} is requesting to view your screen.
            </p>
            <div className="mb-6 rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
              If you continue, your screen will be shared in real time with the support operator.
              You can stop sharing at any time.
            </div>
            {isExpired && (
              <p className="mb-4 text-sm text-red-400">This session has expired.</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={startSharing}
                disabled={isExpired}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Allow Screen Sharing
              </button>
              <button
                onClick={cancel}
                className="flex-1 rounded-lg border border-slate-700 px-4 py-3 font-medium text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
            <a
              href={`remotesupport://pair/${sessionId}?token=${encodeURIComponent(token)}&operator=${encodeURIComponent(pairInfo.operatorName)}`}
              className="mt-4 block rounded-lg border border-slate-700 px-4 py-3 text-center text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              Open in Native Android App
            </a>
            <p className="mt-4 text-center text-xs text-slate-500">
              Session {pairInfo.sessionId}
            </p>
          </div>
        )}

        {phase === 'requesting_permission' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
            <h1 className="mb-2 text-xl font-semibold">Waiting for Permission</h1>
            <p className="text-sm text-slate-400">
              Your browser is showing a screen-sharing permission prompt. Please select the screen
              or window you want to share and grant permission.
            </p>
          </div>
        )}

        {phase === 'denied' && (
          <div className="rounded-2xl border border-red-800 bg-red-950/50 p-8 text-center">
            <h1 className="mb-2 text-xl font-semibold text-red-300">Permission Denied</h1>
            <p className="text-sm text-red-200">
              Screen sharing permission was denied. No screen is being shared.
            </p>
            <button
              onClick={() => setPhase('consent')}
              className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
            >
              Try Again
            </button>
          </div>
        )}

        {phase === 'unsupported' && (
          <div className="rounded-2xl border border-amber-800 bg-amber-950/40 p-8 text-center">
            <h1 className="mb-2 text-xl font-semibold text-amber-300">Screen Capture Not Supported</h1>
            <p className="text-sm text-amber-200">
              This browser does not support screen capture (getDisplayMedia). Mobile browsers such as
              Android Chrome and iOS Safari do not expose screen capture to web pages.
            </p>
            <p className="mt-4 text-sm text-amber-200">
              To share a real phone screen, use the native Android app (included in this project) or
              a desktop browser.
            </p>
          </div>
        )}

        {phase === 'sharing' && (
          <div className="rounded-2xl border border-green-800 bg-green-950/40 p-8 text-center">
            <div className="mb-4 flex items-center justify-center gap-2">
              <span className="h-3 w-3 animate-pulse rounded-full bg-green-400" />
              <h1 className="text-xl font-semibold text-green-300">Screen Sharing Active</h1>
            </div>
            <p className="mb-6 text-sm text-green-200">
              Your screen is being shared in real time with {pairInfo?.operatorName ?? 'the operator'}.
            </p>
            <div className="mb-6 flex justify-center gap-6 text-xs text-slate-400">
              <span>WebRTC: {pcState}</span>
              <span>ICE: {iceState}</span>
            </div>
            <button
              onClick={() => void stopSharing('device')}
              className="w-full rounded-lg bg-red-600 px-4 py-3 font-medium hover:bg-red-500"
            >
              Stop Screen Sharing
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
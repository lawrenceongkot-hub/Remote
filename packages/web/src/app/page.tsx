'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateSessionResponse, SessionInfo, WsMessage } from '@/lib/types';
import { createPeerConnection, getIceServers, sendWs, wsUrl } from '@/lib/webrtc';

function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString();
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function isExpired(info: SessionInfo | null): boolean {
  if (!info) return false;
  return new Date(info.expiresAt).getTime() < Date.now();
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    WAITING_FOR_DEVICE: 'bg-slate-700 text-slate-200',
    PAIRING: 'bg-amber-900/60 text-amber-300',
    CONNECTING: 'bg-blue-900/60 text-blue-300',
    CONNECTED: 'bg-blue-900/60 text-blue-300',
    SCREEN_SHARING: 'bg-green-900/60 text-green-300',
    DISCONNECTED: 'bg-orange-900/60 text-orange-300',
    FAILED: 'bg-red-900/60 text-red-300',
    ENDED: 'bg-slate-700 text-slate-300',
    EXPIRED: 'bg-slate-700 text-slate-400',
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${colors[status] ?? 'bg-slate-700 text-slate-200'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function DashboardPage() {
  // The operator API key is held in React state (memory) only. It is never
  // written to localStorage, never included in QR codes, and never sent to the
  // signaling server — the server issues a short-lived wsToken per session.
  const [apiKey, setApiKey] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [wsState, setWsState] = useState<'idle' | 'connecting' | 'open' | 'closed'>('idle');
  const [pcState, setPcState] = useState<RTCPeerConnectionState | 'new'>('new');
  const [iceState, setIceState] = useState<RTCIceConnectionState | 'new'>('new');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const wsTokenRef = useRef<string | null>(null);
  const iceServersRef = useRef<Promise<Awaited<ReturnType<typeof getIceServers>>> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (remoteStream && videoRef.current) {
      videoRef.current.srcObject = remoteStream;
      videoRef.current.play().catch(() => {
        // autoplay may be blocked; user interaction will resume
      });
    }
  }, [remoteStream]);

  const saveApiKey = useCallback(() => {
    const key = apiKeyInput.trim();
    if (!key) return;
    setApiKey(key);
    setApiKeyInput('');
  }, [apiKeyInput]);

  const clearApiKey = useCallback(() => {
    if (wsRef.current) wsRef.current.close();
    if (pcRef.current) pcRef.current.close();
    setApiKey('');
  }, []);

  const cleanupPeer = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setRemoteStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleWsMessage = useCallback(
    async (msg: WsMessage) => {
      switch (msg.type) {
        case 'device_joined':
          setSessionInfo((prev) => (prev ? { ...prev, status: 'PAIRING', deviceInfo: msg.deviceInfo } : prev));
          break;
        case 'device_consent_granted':
          setSessionInfo((prev) => (prev ? { ...prev, status: 'CONNECTING' } : prev));
          break;
        case 'device_consent_denied':
          setSessionInfo((prev) =>
            prev
              ? { ...prev, status: 'FAILED', lastError: 'User denied consent', endedAt: new Date().toISOString() }
              : prev
          );
          break;
        case 'device_capture_started':
          setSessionInfo((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'SCREEN_SHARING',
                  startedAt: prev.startedAt ?? new Date().toISOString(),
                }
              : prev
          );
          break;
        case 'device_capture_failed':
        case 'device_capture_unsupported':
          setSessionInfo((prev) =>
            prev
              ? { ...prev, status: 'FAILED', lastError: msg.error, endedAt: new Date().toISOString() }
              : prev
          );
          break;
        case 'offer': {
          const pc = pcRef.current;
          if (!pc) return;
          await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWs(wsRef.current!, { type: 'answer', sessionId: msg.sessionId, sdp: answer.sdp ?? '' });
          break;
        }
        case 'answer': {
          const pc = pcRef.current;
          if (!pc) return;
          await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
          break;
        }
        case 'ice': {
          const pc = pcRef.current;
          if (!pc) return;
          await pc.addIceCandidate(msg.candidate);
          break;
        }
        case 'peer_connected':
          setSessionInfo((prev) => (prev ? { ...prev, status: 'CONNECTED' } : prev));
          break;
        case 'peer_disconnected':
          setSessionInfo((prev) =>
            prev ? { ...prev, status: 'DISCONNECTED', endedAt: new Date().toISOString() } : prev
          );
          break;
        case 'peer_failed':
          setSessionInfo((prev) =>
            prev
              ? { ...prev, status: 'FAILED', lastError: 'WebRTC peer connection failed', endedAt: new Date().toISOString() }
              : prev
          );
          break;
        case 'session_ended':
          setSessionInfo((prev) =>
            prev ? { ...prev, status: 'ENDED', endedAt: new Date().toISOString() } : prev
          );
          cleanupPeer();
          break;
        case 'error':
          setError(msg.message);
          break;
      }
    },
    [cleanupPeer]
  );

  const connectSignaling = useCallback(
    async (sessionId: string, wsToken: string) => {
      setWsState('connecting');
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setWsState('open');
        sendWs(ws, { type: 'hello', role: 'operator', sessionId, wsToken });
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data as string) as WsMessage;
        await handleWsMessage(msg);
      };

      ws.onclose = () => {
        setWsState('closed');
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
        setWsState('closed');
      };
    },
    [handleWsMessage]
  );

  const createSession = useCallback(async () => {
    setError(null);
    setRemoteStream(null);
    setSessionInfo(null);
    setPcState('new');
    setIceState('new');
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to create session (${res.status})`);
      }
      const data: CreateSessionResponse = await res.json();
      setSession(data);
      setSessionInfo(data.session);
      sessionIdRef.current = data.session.id;
      wsTokenRef.current = data.wsToken;
      await connectSignaling(data.session.id, data.wsToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  }, [apiKey, connectSignaling]);

  const startPeer = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    if (!iceServersRef.current) {
      iceServersRef.current = getIceServers();
    }
    const iceServers = await iceServersRef.current;

    const pc = createPeerConnection(iceServers, {
      onTrack: (stream) => setRemoteStream(stream),
      onConnectionStateChange: (state) => {
        setPcState(state);
        if (state === 'connected') {
          setSessionInfo((prev) => (prev ? { ...prev, status: 'CONNECTED' } : prev));
        }
        if (state === 'failed') {
          setSessionInfo((prev) =>
            prev
              ? { ...prev, status: 'FAILED', lastError: 'WebRTC connection failed', endedAt: new Date().toISOString() }
              : prev
          );
        }
        if (state === 'disconnected' || state === 'closed') {
          setSessionInfo((prev) =>
            prev ? { ...prev, status: 'DISCONNECTED', endedAt: new Date().toISOString() } : prev
          );
        }
      },
      onIceConnectionStateChange: (state) => setIceState(state),
      onNegotiationNeeded: () => {
        // Operator is the answerer; device initiates offers
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

    pcRef.current = pc;
  }, []);

  useEffect(() => {
    if (sessionInfo?.status === 'CONNECTING' && !pcRef.current) {
      void startPeer();
    }
  }, [sessionInfo?.status, startPeer]);

  const stopSession = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    sendWs(wsRef.current!, { type: 'stop_session', sessionId, reason: 'operator' });
    cleanupPeer();
    setSessionInfo((prev) => (prev ? { ...prev, status: 'ENDED', endedAt: new Date().toISOString() } : prev));
  }, [cleanupPeer]);

  const status = sessionInfo?.status ?? 'WAITING_FOR_DEVICE';
  const isLive = status === 'SCREEN_SHARING' && pcState === 'connected' && remoteStream !== null;
  const durationMs =
    sessionInfo?.startedAt && sessionInfo.status !== 'ENDED'
      ? now - new Date(sessionInfo.startedAt).getTime()
      : 0;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight">Remote Support Dashboard</h1>
          <p className="mt-2 text-slate-400">
            Consent-based real-time screen sharing. The stream you see is the actual device screen.
          </p>
        </header>

        {!apiKey ? (
          <section className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8">
            <h2 className="mb-4 text-xl font-semibold">Operator Authentication</h2>
            <p className="mb-4 text-sm text-slate-400">
              Enter an operator API key generated at{' '}
              <a href="/generateapi" className="text-blue-400 underline">
                /generateapi
              </a>
              . The key is used only in memory for this browser session and is never stored.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveApiKey()}
                placeholder="Operator API key"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <button
                onClick={saveApiKey}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
              >
                Sign In
              </button>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Not an operator? Go to <a href="/generateapi" className="text-blue-400 underline">/generateapi</a> to log in as admin and generate a key.
            </p>
          </section>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={createSession}
                  disabled={
                    !!session &&
                    status !== 'ENDED' &&
                    status !== 'FAILED' &&
                    status !== 'EXPIRED' &&
                    status !== 'DISCONNECTED'
                  }
                  className="rounded-lg bg-blue-600 px-5 py-2.5 font-medium hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Create QR Code
                </button>
                {session && (
                  <button
                    onClick={stopSession}
                    disabled={status === 'ENDED' || status === 'FAILED' || status === 'EXPIRED'}
                    className="rounded-lg bg-red-600 px-5 py-2.5 font-medium hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Stop Session
                  </button>
                )}
              </div>
              <button onClick={clearApiKey} className="text-sm text-slate-500 hover:text-slate-300">
                Sign out
              </button>
            </div>

            {error && (
              <div className="mb-6 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {!session ? (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-16 text-center">
                <p className="text-slate-400">
                  Click <span className="text-slate-200">Create QR Code</span> to start a new support session.
                </p>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
                <div className="space-y-6">
                  <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
                    <h2 className="mb-4 text-lg font-semibold">Pairing QR Code</h2>
                    {session.qrDataUrl ? (
                      <div className="flex flex-col items-center gap-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={session.qrDataUrl}
                          alt="Pairing QR code"
                          className="h-64 w-64 rounded-lg bg-white p-2"
                        />
                        <p className="text-center text-sm text-slate-400">
                          Scan with the device camera to open the consent page.
                        </p>
                      </div>
                    ) : (
                      <p className="text-slate-400">Generating QR code…</p>
                    )}
                  </section>

                  <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
                    <h2 className="mb-4 text-lg font-semibold">Session Details</h2>
                    <dl className="space-y-3 text-sm">
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Session ID</dt>
                        <dd className="break-all text-right font-mono text-xs">{sessionInfo?.id}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Status</dt>
                        <dd>
                          <StatusBadge status={status} />
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Created</dt>
                        <dd>{formatTime(sessionInfo?.createdAt)}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Expires</dt>
                        <dd className={isExpired(sessionInfo) ? 'text-red-400' : ''}>
                          {formatTime(sessionInfo?.expiresAt)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Started</dt>
                        <dd>{sessionInfo?.startedAt ? formatTime(sessionInfo.startedAt) : '—'}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Duration</dt>
                        <dd>{durationMs > 0 ? formatDuration(durationMs) : '—'}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">WebRTC</dt>
                        <dd className="font-mono text-xs">{pcState}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">ICE</dt>
                        <dd className="font-mono text-xs">{iceState}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-400">Signaling</dt>
                        <dd className="font-mono text-xs">{wsState}</dd>
                      </div>
                    </dl>
                  </section>

                  {sessionInfo?.deviceInfo && (
                    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
                      <h2 className="mb-4 text-lg font-semibold">Device Information</h2>
                      <dl className="space-y-2 text-sm">
                        {Object.entries(sessionInfo.deviceInfo).map(([key, value]) => (
                          <div key={key} className="flex justify-between gap-4">
                            <dt className="text-slate-400 capitalize">{key.replace(/_/g, ' ')}</dt>
                            <dd className="break-all text-right">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  )}
                </div>

                <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Live Screen Viewer</h2>
                    {isLive && (
                      <span className="flex items-center gap-2 rounded-full bg-green-900/60 px-3 py-1 text-xs font-medium text-green-300">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                        Screen Sharing Active
                      </span>
                    )}
                  </div>

                  <div className="relative aspect-[9/19] max-h-[70vh] w-full overflow-hidden rounded-xl border border-slate-700 bg-black">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                    {!isLive && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                        <p className="text-lg font-medium text-slate-300">
                          {status === 'WAITING_FOR_DEVICE' && 'Waiting for device…'}
                          {status === 'PAIRING' && 'Device connected — waiting for consent…'}
                          {status === 'CONNECTING' && 'Establishing WebRTC connection…'}
                          {status === 'CONNECTED' && 'WebRTC connected — waiting for screen stream…'}
                          {status === 'DISCONNECTED' && 'Connection lost'}
                          {status === 'FAILED' && (sessionInfo?.lastError ?? 'Session failed')}
                          {status === 'ENDED' && 'Screen Sharing Ended'}
                          {status === 'EXPIRED' && 'Session expired'}
                        </p>
                        {status === 'FAILED' && sessionInfo?.lastError && (
                          <p className="text-sm text-slate-500">{sessionInfo.lastError}</p>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
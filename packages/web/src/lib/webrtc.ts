import type { IceServerConfig, WsMessage } from './types';

export interface PeerConnectionCallbacks {
  onTrack: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onIceConnectionStateChange: (state: RTCIceConnectionState) => void;
  onNegotiationNeeded: () => void;
  onError: (error: Error) => void;
}

export function createPeerConnection(
  iceServers: IceServerConfig[],
  callbacks: PeerConnectionCallbacks
): RTCPeerConnection {
  const pc = new RTCPeerConnection({
    iceServers: iceServers.map((s) => ({
      urls: s.urls,
      username: s.username,
      credential: s.credential,
    })),
    iceCandidatePoolSize: 10,
  });

  pc.onconnectionstatechange = () => {
    callbacks.onConnectionStateChange(pc.connectionState);
  };

  pc.oniceconnectionstatechange = () => {
    callbacks.onIceConnectionStateChange(pc.iceConnectionState);
  };

  pc.onnegotiationneeded = () => {
    callbacks.onNegotiationNeeded();
  };

  pc.ontrack = (event) => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    callbacks.onTrack(stream);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      callbacks.onError(new Error('ICE candidate should be handled by caller'));
    }
  };

  pc.onicecandidateerror = (event) => {
    callbacks.onError(new Error(`ICE candidate error: ${event.errorCode} ${event.errorText ?? ''}`));
  };

  return pc;
}

export function sendWs(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function wsUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (process.env.NODE_ENV !== 'production') {
    const host = process.env.NEXT_PUBLIC_WS_HOST || 'localhost:3000';
    return `${proto}//${host}/ws`;
  }
  // Production: must be explicitly configured or signaling is broken. NO localhost fallback.
  const url = process.env.PUBLIC_WS_URL || process.env.SIGNALING_SERVER_URL;
  if (!url) return '';
  return url;
}

export function getIceServers(): Promise<IceServerConfig[]> {
  return fetch('/api/ice-servers')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch ICE servers');
      return res.json();
    })
    .then((data: { iceServers: IceServerConfig[] }) => data.iceServers);
}
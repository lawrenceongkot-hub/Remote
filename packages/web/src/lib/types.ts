export type SessionStatus =
  | 'WAITING_FOR_DEVICE'
  | 'PAIRING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'SCREEN_SHARING'
  | 'DISCONNECTED'
  | 'FAILED'
  | 'ENDED'
  | 'EXPIRED';

export interface SessionInfo {
  id: string;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
  startedAt: string | null;
  endedAt: string | null;
  deviceInfo: Record<string, string> | null;
  lastError: string | null;
}

export interface CreateSessionResponse {
  session: SessionInfo;
  pairingUrl: string;
  qrDataUrl: string;
  wsToken: string;
  expiresInMs: number;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceServersResponse {
  iceServers: IceServerConfig[];
}

export type WsMessage =
  | { type: 'hello'; role: 'operator' | 'device'; sessionId: string; token?: string; wsToken?: string }
  | { type: 'device_joined'; sessionId: string; deviceInfo: Record<string, string> }
  | { type: 'device_consent_granted'; sessionId: string }
  | { type: 'device_consent_denied'; sessionId: string }
  | { type: 'device_capture_started'; sessionId: string }
  | { type: 'device_capture_failed'; sessionId: string; error: string }
  | { type: 'device_capture_unsupported'; sessionId: string; error: string }
  | { type: 'offer'; sessionId: string; sdp: string }
  | { type: 'answer'; sessionId: string; sdp: string }
  | { type: 'ice'; sessionId: string; candidate: RTCIceCandidateInit }
  | { type: 'peer_connected'; sessionId: string }
  | { type: 'peer_disconnected'; sessionId: string }
  | { type: 'peer_failed'; sessionId: string }
  | { type: 'stop_session'; sessionId: string; reason: 'operator' | 'device' | 'expired' }
  | { type: 'session_ended'; sessionId: string; reason: 'operator' | 'device' | 'expired' }
  | { type: 'error'; sessionId: string; message: string };
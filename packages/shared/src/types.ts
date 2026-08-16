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

export interface SupportSession {
  id: string;
  operatorId: string;
  pairingTokenHash: string;
  wsTokenHash: string | null;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
  startedAt: string | null;
  endedAt: string | null;
  deviceInfo: Record<string, string> | null;
  lastError: string | null;
}

export interface Operator {
  id: string;
  name: string;
  apiKeyHash: string;
  createdAt: string;
}

export type WsRole = 'operator' | 'device';

export interface IceCandidateInit {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
}

export type WsMessage =
  | { type: 'hello'; role: WsRole; sessionId: string; token?: string; wsToken?: string }
  | { type: 'device_joined'; sessionId: string; deviceInfo: Record<string, string> }
  | { type: 'device_consent_granted'; sessionId: string }
  | { type: 'device_consent_denied'; sessionId: string }
  | { type: 'device_capture_started'; sessionId: string }
  | { type: 'device_capture_failed'; sessionId: string; error: string }
  | { type: 'device_capture_unsupported'; sessionId: string; error: string }
  | { type: 'offer'; sessionId: string; sdp: string }
  | { type: 'answer'; sessionId: string; sdp: string }
  | { type: 'ice'; sessionId: string; candidate: IceCandidateInit }
  | { type: 'peer_connected'; sessionId: string }
  | { type: 'peer_disconnected'; sessionId: string }
  | { type: 'peer_failed'; sessionId: string }
  | { type: 'stop_session'; sessionId: string; reason: 'operator' | 'device' | 'expired' }
  | { type: 'session_ended'; sessionId: string; reason: 'operator' | 'device' | 'expired' }
  | { type: 'error'; sessionId: string; message: string };
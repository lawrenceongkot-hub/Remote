import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import {
  getSessionById,
  getSessionByTokenHash,
  getSessionByWsTokenHash,
  updateSessionStatus,
  expireStaleSessions,
  hashToken,
  safeEqual,
} from '@remote-support/shared';
import type { SessionStatus, SupportSession, WsMessage, WsRole } from '@remote-support/shared';

interface Client {
  ws: WebSocket;
  role: WsRole;
  sessionId: string;
  operatorId?: string;
}

const clients = new Map<WebSocket, Client>();

function send(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function findPeer(sessionId: string, role: WsRole): Client | undefined {
  for (const client of clients.values()) {
    if (client.sessionId === sessionId && client.role === role) {
      return client;
    }
  }
  return undefined;
}

function broadcastToSession(sessionId: string, msg: WsMessage): void {
  for (const client of clients.values()) {
    if (client.sessionId === sessionId) {
      send(client.ws, msg);
    }
  }
}

function isSessionActive(status: SessionStatus): boolean {
  return (
    status === 'WAITING_FOR_DEVICE' ||
    status === 'PAIRING' ||
    status === 'CONNECTING' ||
    status === 'CONNECTED' ||
    status === 'SCREEN_SHARING'
  );
}

export function setupSignaling(wss: WebSocketServer): void {
  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin;
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (origin && !allowedOrigins.includes(origin)) {
      ws.close(1008, 'Origin not allowed');
      return;
    }

    ws.on('message', async (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsMessage;
      } catch {
        send(ws, { type: 'error', sessionId: '', message: 'Invalid message format' });
        return;
      }

      try {
        await handleMessage(ws, msg);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        send(ws, { type: 'error', sessionId: msg.sessionId, message });
      }
    });

    ws.on('close', () => {
      const client = clients.get(ws);
      if (client) {
        clients.delete(ws);
        const peer = findPeer(client.sessionId, client.role === 'operator' ? 'device' : 'operator');
        if (peer) {
          send(peer.ws, {
            type: 'peer_disconnected',
            sessionId: client.sessionId,
          });
        }
      }
    });

    ws.on('error', () => {
      const client = clients.get(ws);
      if (client) {
        clients.delete(ws);
      }
    });
  });
}

async function handleMessage(ws: WebSocket, msg: WsMessage): Promise<void> {
  switch (msg.type) {
    case 'hello': {
      const session = await getSessionById(msg.sessionId);
      if (!session) {
        send(ws, { type: 'error', sessionId: msg.sessionId, message: 'Session not found' });
        ws.close(1008, 'Session not found');
        return;
      }

      if (msg.role === 'device') {
        if (!msg.token) {
          send(ws, { type: 'error', sessionId: msg.sessionId, message: 'Pairing token required' });
          ws.close(1008, 'Pairing token required');
          return;
        }
        const byHash = await getSessionByTokenHash(hashToken(msg.token));
        if (!byHash || byHash.id !== session.id) {
          send(ws, { type: 'error', sessionId: msg.sessionId, message: 'Invalid pairing token' });
          ws.close(1008, 'Invalid pairing token');
          return;
        }
        if (!isSessionActive(session.status)) {
          send(ws, { type: 'error', sessionId: msg.sessionId, message: `Session is ${session.status}` });
          ws.close(1008, `Session is ${session.status}`);
          return;
        }
        if (new Date(session.expiresAt).getTime() < Date.now()) {
          await updateSessionStatus(session.id, 'EXPIRED', { endedAt: new Date().toISOString() });
          send(ws, { type: 'error', sessionId: msg.sessionId, message: 'Session expired' });
          ws.close(1008, 'Session expired');
          return;
        }
      }

      if (msg.role === 'operator') {
        // Operator authenticates with a short-lived wsToken issued by the API
        // when the session was created. The API key itself is never sent here.
        if (!msg.wsToken) {
          send(ws, { type: 'error', sessionId: msg.sessionId, message: 'wsToken required' });
          ws.close(1008, 'wsToken required');
          return;
        }
        const byWsToken = await getSessionByWsTokenHash(hashToken(msg.wsToken));
        if (!byWsToken || byWsToken.id !== session.id) {
          send(ws, { type: 'error', sessionId: msg.sessionId, message: 'Invalid wsToken' });
          ws.close(1008, 'Invalid wsToken');
          return;
        }
        if (!isSessionActive(session.status)) {
          send(ws, { type: 'error', sessionId: msg.sessionId, message: `Session is ${session.status}` });
          ws.close(1008, `Session is ${session.status}`);
          return;
        }
      }

      if (msg.role === 'operator') {
        const existing = findPeer(msg.sessionId, 'operator');
        if (existing && existing.ws !== ws) {
          send(existing.ws, { type: 'error', sessionId: msg.sessionId, message: 'Replaced by new operator connection' });
          existing.ws.close(1008, 'Replaced');
        }
      }

      clients.set(ws, {
        ws,
        role: msg.role,
        sessionId: msg.sessionId,
        operatorId: msg.role === 'operator' ? session.operatorId : undefined,
      });

      if (msg.role === 'operator') {
        const peer = findPeer(msg.sessionId, 'device');
        if (peer) {
          send(peer.ws, { type: 'peer_connected', sessionId: msg.sessionId });
        }
      }
      break;
    }

    case 'device_joined': {
      const client = clients.get(ws);
      if (!client || client.role !== 'device') return;
      await updateSessionStatus(msg.sessionId, 'PAIRING', { deviceInfo: msg.deviceInfo });
      broadcastToSession(msg.sessionId, msg);
      break;
    }

    case 'device_consent_granted': {
      const client = clients.get(ws);
      if (!client || client.role !== 'device') return;
      await updateSessionStatus(msg.sessionId, 'CONNECTING');
      broadcastToSession(msg.sessionId, msg);
      break;
    }

    case 'device_consent_denied': {
      const client = clients.get(ws);
      if (!client || client.role !== 'device') return;
      await updateSessionStatus(msg.sessionId, 'FAILED', {
        endedAt: new Date().toISOString(),
        lastError: 'User denied consent',
      });
      broadcastToSession(msg.sessionId, msg);
      break;
    }

    case 'device_capture_started': {
      const client = clients.get(ws);
      if (!client || client.role !== 'device') return;
      await updateSessionStatus(msg.sessionId, 'SCREEN_SHARING', {
        startedAt: new Date().toISOString(),
      });
      broadcastToSession(msg.sessionId, msg);
      break;
    }

    case 'device_capture_failed':
    case 'device_capture_unsupported': {
      const client = clients.get(ws);
      if (!client || client.role !== 'device') return;
      await updateSessionStatus(msg.sessionId, 'FAILED', {
        endedAt: new Date().toISOString(),
        lastError: msg.error,
      });
      broadcastToSession(msg.sessionId, msg);
      break;
    }

    case 'offer':
    case 'answer':
    case 'ice': {
      const client = clients.get(ws);
      if (!client) return;
      const peerRole: WsRole = client.role === 'operator' ? 'device' : 'operator';
      const peer = findPeer(msg.sessionId, peerRole);
      if (peer) {
        send(peer.ws, msg);
      }
      break;
    }

    case 'peer_connected': {
      const client = clients.get(ws);
      if (!client) return;
      await updateSessionStatus(msg.sessionId, 'CONNECTED');
      broadcastToSession(msg.sessionId, msg);
      break;
    }

    case 'peer_disconnected': {
      const client = clients.get(ws);
      if (!client) return;
      const session = await getSessionById(msg.sessionId);
      if (session && isSessionActive(session.status)) {
        await updateSessionStatus(msg.sessionId, 'DISCONNECTED', {
          endedAt: new Date().toISOString(),
        });
      }
      broadcastToSession(msg.sessionId, msg);
      break;
    }

    case 'peer_failed': {
      const client = clients.get(ws);
      if (!client) return;
      const session = await getSessionById(msg.sessionId);
      if (session && isSessionActive(session.status)) {
        await updateSessionStatus(msg.sessionId, 'FAILED', {
          endedAt: new Date().toISOString(),
          lastError: 'WebRTC peer connection failed',
        });
      }
      broadcastToSession(msg.sessionId, msg);
      break;
    }

    case 'stop_session': {
      const client = clients.get(ws);
      if (!client) return;
      const session = await getSessionById(msg.sessionId);
      if (!session) return;

      if (msg.reason === 'operator') {
        if (client.role !== 'operator') return;
        if (!safeEqual(session.operatorId, client.operatorId ?? '')) return;
      }

      await updateSessionStatus(msg.sessionId, 'ENDED', {
        endedAt: new Date().toISOString(),
      });

      broadcastToSession(msg.sessionId, {
        type: 'session_ended',
        sessionId: msg.sessionId,
        reason: msg.reason,
      });

      for (const c of clients.values()) {
        if (c.sessionId === msg.sessionId) {
          c.ws.close(1000, 'Session ended');
        }
      }
      break;
    }

    case 'session_ended': {
      // informational; clients handle locally
      break;
    }

    case 'error': {
      break;
    }
  }
}

export async function expireSessionsLoop(): Promise<void> {
  await expireStaleSessions(new Date());
  setTimeout(expireSessionsLoop, 30_000);
}
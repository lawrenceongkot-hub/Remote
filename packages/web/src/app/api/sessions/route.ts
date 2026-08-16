import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import {
  createSession,
  generatePairingToken,
  generateSessionId,
  generateWsToken,
  getPublicBaseUrl,
  getSessionTtlMs,
  hashToken,
  initDb,
} from '@remote-support/shared';
import { authenticateOperator } from '@/lib/operator-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const operator = await authenticateOperator(req as never);
  if (!operator) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await initDb();

    const now = new Date();
    const ttlMs = getSessionTtlMs();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const sessionId = generateSessionId();
    const pairingToken = generatePairingToken();
    // Short-lived token used ONLY for the operator's WebSocket auth.
    // The API key itself is never sent to the signaling server.
    const wsToken = generateWsToken();

    await createSession({
      id: sessionId,
      operatorId: operator.operatorId,
      pairingTokenHash: hashToken(pairingToken),
      wsTokenHash: hashToken(wsToken),
      status: 'WAITING_FOR_DEVICE',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      startedAt: null,
      endedAt: null,
      deviceInfo: null,
      lastError: null,
    });

    const baseUrl = getPublicBaseUrl() || 'http://localhost:3000';
    const pairingUrl = `${baseUrl}/pair/${sessionId}?token=${encodeURIComponent(pairingToken)}&operator=${encodeURIComponent(operator.operatorName)}`;
    const qrDataUrl = await QRCode.toDataURL(pairingUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 480,
    });

    return NextResponse.json(
      {
        session: {
          id: sessionId,
          status: 'WAITING_FOR_DEVICE',
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          startedAt: null,
          endedAt: null,
          deviceInfo: null,
          lastError: null,
        },
        pairingUrl,
        qrDataUrl,
        wsToken,
        expiresInMs: ttlMs,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const operator = await authenticateOperator(req as never);
  if (!operator) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Session id required' }, { status: 400 });
  }
  try {
    const { getSessionById } = await import('@remote-support/shared');
    const session = await getSessionById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.operatorId !== operator.operatorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        deviceInfo: session.deviceInfo,
        lastError: session.lastError,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
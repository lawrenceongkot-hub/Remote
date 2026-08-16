import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, updateSessionStatus, initDb } from '@remote-support/shared';

export const dynamic = 'force-dynamic';

// Public pairing metadata. Returns ONLY non-secret info the consent page needs:
// session id, operator name, expiration, and status. Never returns the API key
// or pairing token.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await initDb();
    const session = await getSessionById(params.id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await updateSessionStatus(session.id, 'EXPIRED', { endedAt: new Date().toISOString() });
      return NextResponse.json({ error: 'Session expired' }, { status: 410 });
    }
    if (session.status === 'ENDED') {
      return NextResponse.json({ error: 'Session ended' }, { status: 410 });
    }

    const { getOperatorById } = await import('@remote-support/shared');
    const operator = await getOperatorById(session.operatorId);

    return NextResponse.json({
      sessionId: session.id,
      operatorName: operator?.name ?? 'Support Operator',
      expiresAt: session.expiresAt,
      status: session.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
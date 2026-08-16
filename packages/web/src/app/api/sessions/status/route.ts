import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, initDb } from '@remote-support/shared';
import { authenticateOperator } from '@/lib/operator-auth';

export const dynamic = 'force-dynamic';

// Polls a session's current server-side status. Operator-only.
export async function GET(req: NextRequest) {
  const operator = await authenticateOperator(req as never);
  if (!operator) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Session id required' }, { status: 400 });
    }
    await initDb();
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
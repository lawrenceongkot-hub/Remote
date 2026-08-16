import { NextResponse } from 'next/server';
import { getIceServers } from '@remote-support/shared';

export const dynamic = 'force-dynamic';

// Public ICE config — STUN is public by design; TURN credentials are
// configured server-side and exposed to peers that need them for connectivity.
export async function GET() {
  return NextResponse.json(getIceServers());
}
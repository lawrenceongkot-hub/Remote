import { NextResponse } from 'next/server';
import { getMissingEnvVars } from '@remote-support/shared';
import { isAdminAuthenticated } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

// Returns only whether the admin is authenticated, plus the NAMES of any
// missing required env vars (never the values). Used by /generateapi to
// guide first-time deployment configuration.
export async function GET() {
  try {
    const missing = getMissingEnvVars();
    return NextResponse.json({
      authenticated: missing.length === 0 ? isAdminAuthenticated() : false,
      missingEnvVars: missing,
    });
  } catch {
    return NextResponse.json({ authenticated: false, missingEnvVars: [] });
  }
}
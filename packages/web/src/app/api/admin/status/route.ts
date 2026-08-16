import { NextResponse } from 'next/server';
import { getAdminCredentials } from '@remote-support/shared';
import { isAdminAuthenticated } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

// Returns only whether the admin is authenticated — never any credentials.
export async function GET() {
  try {
    getAdminCredentials();
    return NextResponse.json({ authenticated: isAdminAuthenticated() });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}
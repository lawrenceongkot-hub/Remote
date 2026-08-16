import { NextRequest, NextResponse } from 'next/server';
import { getAdminCredentials } from '@remote-support/shared';
import { createAdminSession, getAdminSessionCookie, getAdminSessionTtlMs } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const username = typeof body?.username === 'string' ? body.username : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    const { username: adminUser, password: adminPass } = getAdminCredentials();

    // Constant-time comparison to avoid timing attacks
    const userOk = username.length === adminUser.length;
    const passOk = password.length === adminPass.length;
    const userMatch = userOk && username === adminUser;
    const passMatch = passOk && password === adminPass;

    if (!userMatch || !passMatch) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = createAdminSession();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(getAdminSessionCookie(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(getAdminSessionTtlMs() / 1000),
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
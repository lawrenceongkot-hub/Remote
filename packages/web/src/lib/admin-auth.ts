import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getAdminCredentials, requireEnv } from '@remote-support/shared';

const COOKIE_NAME = 'rs_admin_session';
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

interface AdminSessionPayload {
  sub: string;
  exp: number;
}

function getSecret(): string {
  return requireEnv('SESSION_SECRET');
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function encodeSession(payload: AdminSessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decodeSession(token: string): AdminSessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = sign(body);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as AdminSessionPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createAdminSession(): string {
  const { username } = getAdminCredentials();
  const payload: AdminSessionPayload = {
    sub: username,
    exp: Date.now() + SESSION_TTL_MS,
  };
  return encodeSession(payload);
}

export function isAdminAuthenticated(): boolean {
  const store = cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return false;
  const payload = decodeSession(token);
  if (!payload) return false;
  const { username } = getAdminCredentials();
  return payload.sub === username;
}

export function getAdminSessionCookie(): string {
  return COOKIE_NAME;
}

export function getAdminSessionTtlMs(): number {
  return SESSION_TTL_MS;
}
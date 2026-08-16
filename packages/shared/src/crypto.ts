import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateSessionId(): string {
  return `sess_${randomBytes(12).toString('base64url')}`;
}

export function generatePairingToken(): string {
  return randomBytes(24).toString('base64url');
}

export function generateApiKey(): string {
  return `rs_${randomBytes(32).toString('base64url')}`;
}

export function generateWsToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function generateOperatorId(): string {
  return `op_${randomBytes(8).toString('base64url')}`;
}
/**
 * Reads production configuration from environment variables ONLY.
 * There are NO hardcoded fallback secrets. If a required secret is
 * missing, the application fails securely with a clear error.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `[config] Missing required environment variable: ${name}. ` +
        'Configure it in your environment (Vercel project settings or .env for local dev). ' +
        'The system will not start with an insecure default.'
    );
  }
  return value.trim();
}

export function getEnv(name: string, fallback?: string): string | undefined {
  return process.env[name] || fallback;
}

export function getAdminCredentials(): { username: string; password: string } {
  const username = requireEnv('ADMIN_USERNAME');
  const password = requireEnv('ADMIN_PASSWORD');
  return { username, password };
}

/**
 * Returns the names of required environment variables that are missing.
 * Used by the admin UI to guide configuration — never the values.
 */
export function getMissingEnvVars(): string[] {
  const required = [
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'SESSION_SECRET',
    'DATABASE_URL',
  ];
  return required.filter((name) => !process.env[name] || process.env[name]?.trim() === '');
}

export function getPublicBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL;
  if (configured) return configured;
  // In development the Next.js app runs on :3000 and the signaling server on :3001.
  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000';
  }
  // In production the app URL is injected by Vercel (PUBLIC_APP_URL). No localhost fallback.
  const url = process.env.PUBLIC_APP_URL;
  if (!url) {
    throw new Error('[config] PUBLIC_APP_URL is not set in the production environment. Refusing to start with an insecure default.');
  }
  return url;
}

export function getSessionTtlMs(): number {
  const raw = process.env.SESSION_TTL_MS;
  if (!raw) return 5 * 60 * 1000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000;
}

export function getStunServers(): string[] {
  const raw = process.env.STUN_SERVERS;
  if (!raw) return ['stun:stun.l.google.com:19302'];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTurn(raw: string): { urls: string[]; username?: string; credential?: string }[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to pipe-separated format
  }
  return raw
    .split('|')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      return {
        urls: parts[0] ? [parts[0]] : [],
        username: parts[1] || undefined,
        credential: parts[2] || undefined,
      };
    });
}

export function getTurnServers(): { urls: string[]; username?: string; credential?: string }[] {
  const raw = process.env.TURN_SERVERS;
  if (!raw) return [];
  return parseTurn(raw);
}

export function getIceServers(): { iceServers: { urls: string | string[]; username?: string; credential?: string }[] } {
  return {
    iceServers: [
      ...getStunServers().map((url) => ({ urls: url })),
      ...getTurnServers(),
    ],
  };
}
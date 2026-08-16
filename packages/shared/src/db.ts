import pg from 'pg';
import type { Operator, SessionStatus, SupportSession } from './types.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      '[config] DATABASE_URL is required. Set it in your environment (Vercel project settings or .env for local dev). Failing securely — no default database.'
    );
  }
  return url;
}

export function resetPool(): void {
  if (pool) {
    void pool.end().catch(() => {});
    pool = null;
  }
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  operator_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_sessions (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id),
  pairing_token_hash TEXT NOT NULL,
  ws_token_hash TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  device_info JSONB,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_support_sessions_status ON support_sessions(status);
CREATE INDEX IF NOT EXISTS idx_support_sessions_expires_at ON support_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_operator_id ON api_keys(operator_id);

-- Migrations for existing dev databases
ALTER TABLE support_sessions ADD COLUMN IF NOT EXISTS ws_token_hash TEXT;
-- Legacy field; API keys now live in the api_keys table.
ALTER TABLE operators DROP COLUMN IF EXISTS api_key_hash;
`;

export async function initDb(): Promise<void> {
  await getPool().query(SCHEMA_SQL);
}

function rowToSession(row: Record<string, unknown>): SupportSession {
  return {
    id: row.id as string,
    operatorId: row.operator_id as string,
    pairingTokenHash: row.pairing_token_hash as string,
    wsTokenHash: (row.ws_token_hash as string | null) ?? null,
    status: row.status as SessionStatus,
    createdAt: (row.created_at as Date).toISOString(),
    expiresAt: (row.expires_at as Date).toISOString(),
    startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
    endedAt: row.ended_at ? (row.ended_at as Date).toISOString() : null,
    deviceInfo: (row.device_info as Record<string, string> | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
  };
}

export async function createOperator(id: string, name: string): Promise<void> {
  await getPool().query(
    `INSERT INTO operators (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [id, name]
  );
}

export async function getOperatorById(id: string): Promise<Operator | null> {
  const res = await getPool().query(
    `SELECT id, name, created_at AS "createdAt" FROM operators WHERE id = $1`,
    [id]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return { id: r.id, name: r.name, apiKeyHash: '', createdAt: r.createdAt.toISOString() };
}

export async function storeApiKey(keyId: string, keyHash: string, operatorId: string): Promise<void> {
  await getPool().query(
    `INSERT INTO api_keys (id, key_hash, operator_id) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [keyId, keyHash, operatorId]
  );
}

export async function findOperatorByApiKeyHash(keyHash: string): Promise<Operator | null> {
  const res = await getPool().query(
    `SELECT o.id, o.name, o.created_at AS "createdAt"
     FROM api_keys k
     JOIN operators o ON o.id = k.operator_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL
     LIMIT 1`,
    [keyHash]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return { id: r.id, name: r.name, apiKeyHash: '', createdAt: r.createdAt.toISOString() };
}

export async function touchApiKeyLastUsed(keyHash: string): Promise<void> {
  await getPool().query(
    `UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1`,
    [keyHash]
  );
}

export async function createSession(session: SupportSession): Promise<void> {
  await getPool().query(
    `INSERT INTO support_sessions
       (id, operator_id, pairing_token_hash, ws_token_hash, status, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      session.id,
      session.operatorId,
      session.pairingTokenHash,
      session.wsTokenHash ?? null,
      session.status,
      session.createdAt,
      session.expiresAt,
    ]
  );
}

export async function getSessionById(id: string): Promise<SupportSession | null> {
  const res = await getPool().query(`SELECT * FROM support_sessions WHERE id = $1`, [id]);
  if (res.rows.length === 0) return null;
  return rowToSession(res.rows[0]);
}

export async function getSessionByTokenHash(hash: string): Promise<SupportSession | null> {
  const res = await getPool().query(`SELECT * FROM support_sessions WHERE pairing_token_hash = $1`, [hash]);
  if (res.rows.length === 0) return null;
  return rowToSession(res.rows[0]);
}

export async function getSessionByWsTokenHash(hash: string): Promise<SupportSession | null> {
  const res = await getPool().query(`SELECT * FROM support_sessions WHERE ws_token_hash = $1`, [hash]);
  if (res.rows.length === 0) return null;
  return rowToSession(res.rows[0]);
}

export async function updateSessionStatus(
  id: string,
  status: SessionStatus,
  extra?: {
    startedAt?: string;
    endedAt?: string;
    deviceInfo?: Record<string, string> | null;
    lastError?: string | null;
  }
): Promise<void> {
  const sets: string[] = ['status = $2'];
  const values: unknown[] = [id, status];
  if (extra?.startedAt !== undefined) {
    values.push(extra.startedAt);
    sets.push(`started_at = $${values.length}`);
  }
  if (extra?.endedAt !== undefined) {
    values.push(extra.endedAt);
    sets.push(`ended_at = $${values.length}`);
  }
  if (extra?.deviceInfo !== undefined) {
    values.push(JSON.stringify(extra.deviceInfo));
    sets.push(`device_info = $${values.length}`);
  }
  if (extra?.lastError !== undefined) {
    values.push(extra.lastError);
    sets.push(`last_error = $${values.length}`);
  }
  await getPool().query(`UPDATE support_sessions SET ${sets.join(', ')} WHERE id = $1`, values);
}

export async function expireStaleSessions(now: Date): Promise<void> {
  await getPool().query(
    `UPDATE support_sessions
     SET status = 'EXPIRED', ended_at = COALESCE(ended_at, now())
     WHERE status IN ('WAITING_FOR_DEVICE', 'PAIRING', 'CONNECTING')
       AND expires_at < $1`,
    [now.toISOString()]
  );
}
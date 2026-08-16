import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Starts a local embedded PostgreSQL instance for development when no
 * external DATABASE_URL is configured. Uses real PostgreSQL binaries.
 */
async function main() {
  const dataDir = join(process.cwd(), '.embedded-pg-data');
  mkdirSync(dataDir, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: 5433,
    user: 'remote_support',
    password: 'remote_support_dev',
    authMethod: 'password',
    persistent: true,
    onLog: (msg) => console.log(`[embedded-pg] ${msg}`),
    onError: (err) => console.error(`[embedded-pg] ${err}`),
  });

  try {
    await pg.initialise();
  } catch {
    console.log('[embedded-pg] Data directory already initialised');
  }

  await pg.start();
  console.log('[embedded-pg] Running on port 5433');

  try {
    await pg.createDatabase('remote_support');
    console.log('[embedded-pg] Database remote_support ready');
  } catch {
    console.log('[embedded-pg] Database remote_support already exists');
  }

  // Keep process alive
  const shutdown = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

main().catch((err) => {
  console.error('[embedded-pg] Failed:', err);
  process.exit(1);
});
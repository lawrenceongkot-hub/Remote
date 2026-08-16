import 'dotenv/config';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { initDb, getIceServers } from '@remote-support/shared';
import { setupSignaling, expireSessionsLoop } from './signaling.js';

async function main(): Promise<void> {
  await initDb();
  console.log('[signaling] Database initialized');

  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url?.startsWith('/api/ice-servers')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getIceServers()));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'remote-support-signaling' }));
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  setupSignaling(wss);

  const port = parseInt(process.env.PORT || '3001', 10);
  server.listen(port, () => {
    console.log(`[signaling] Listening on ws://localhost:${port}/ws`);
  });

  void expireSessionsLoop();
}

main().catch((err) => {
  console.error('[signaling] Fatal startup error:', err);
  process.exit(1);
});
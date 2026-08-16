// Real signaling integration test for the NEW secure flow:
//   admin login → generate API key → create session (wsToken) →
//   operator WS (wsToken) + device WS (pairing token) → SDP/ICE relay →
//   stop session → old token rejected.
//
// Requires a running Next.js dev server on :3000 and signaling server on :3001.

const WEB = process.env.WEB_URL || 'http://localhost:3000';
const WS_URL = process.env.WS_URL || 'ws://localhost:3001/ws';
// Credentials are read from environment ONLY — never hardcoded in committed code.
const ADMIN_USER = process.env.ADMIN_USERNAME;
const ADMIN_PASS = process.env.ADMIN_PASSWORD;
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('ADMIN_USERNAME and ADMIN_PASSWORD environment variables are required to run the signaling test.');
  process.exit(1);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('WS connect failed'));
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

async function main() {
  // 1. Admin login
  const loginRes = await fetch(`${WEB}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!loginRes.ok) throw new Error(`Admin login failed: ${loginRes.status}`);
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  console.log('Admin login OK');

  // 2. Generate API key (server-side, CSPRNG)
  const genRes = await fetch(`${WEB}/api/admin/generate-key`, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  });
  if (!genRes.ok) throw new Error(`Generate key failed: ${genRes.status}`);
  const { apiKey } = await genRes.json();
  console.log('API key generated (cryptographically random server-side)');

  // 3. Create session with real API key
  const sessRes = await fetch(`${WEB}/api/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!sessRes.ok) throw new Error(`Create session failed: ${sessRes.status}`);
  const session = await sessRes.json();
  const sessionId = session.session.id;
  const wsToken = session.wsToken;
  const pairUrl = new URL(session.pairingUrl);
  const pairingToken = pairUrl.searchParams.get('token');
  console.log(`Session created: ${sessionId}`);

  // 4. Operator WebSocket with wsToken (NOT the API key)
  const opWs = await connect(WS_URL);
  const devWs = await connect(WS_URL);
  const opMsgs = [];
  const devMsgs = [];
  opWs.onmessage = (e) => opMsgs.push(JSON.parse(e.data));
  devWs.onmessage = (e) => devMsgs.push(JSON.parse(e.data));

  send(opWs, { type: 'hello', role: 'operator', sessionId, wsToken });
  send(devWs, { type: 'hello', role: 'device', sessionId, token: pairingToken });
  await new Promise((r) => setTimeout(r, 200));

  send(devWs, { type: 'device_joined', sessionId, deviceInfo: { platform: 'test', model: 'integration' } });
  send(devWs, { type: 'device_consent_granted', sessionId });
  send(devWs, { type: 'device_capture_started', sessionId });
  const fakeOffer = 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=screen\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\n';
  send(devWs, { type: 'offer', sessionId, sdp: fakeOffer });
  await new Promise((r) => setTimeout(r, 200));

  const opGotOffer = opMsgs.some((m) => m.type === 'offer' && m.sdp === fakeOffer);
  const opGotJoined = opMsgs.some((m) => m.type === 'device_joined');
  const opGotCapture = opMsgs.some((m) => m.type === 'device_capture_started');

  send(opWs, { type: 'ice', sessionId, candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 } });
  await new Promise((r) => setTimeout(r, 200));
  const devGotIce = devMsgs.some((m) => m.type === 'ice');

  // 5. Stop session from operator
  send(opWs, { type: 'stop_session', sessionId, reason: 'operator' });
  await new Promise((r) => setTimeout(r, 300));
  const devGotEnded = devMsgs.some((m) => m.type === 'session_ended');

  // 6. Old pairing token must be rejected
  const reDev = await connect(WS_URL);
  let rej = false;
  reDev.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'error') rej = true;
  };
  send(reDev, { type: 'hello', role: 'device', sessionId, token: pairingToken });
  await new Promise((r) => setTimeout(r, 300));

  console.log('Operator received offer relay:', opGotOffer);
  console.log('Operator received device_joined:', opGotJoined);
  console.log('Operator received capture_started:', opGotCapture);
  console.log('Device received ICE relay:', devGotIce);
  console.log('Device received session_ended:', devGotEnded);
  console.log('Old token rejected after end:', rej);

  const ok = opGotOffer && opGotJoined && opGotCapture && devGotIce && devGotEnded && rej;
  console.log(ok ? '✅ SIGNALING TEST PASSED' : '❌ SIGNALING TEST FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
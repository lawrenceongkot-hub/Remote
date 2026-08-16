// Security verification script — checks the 15-point security requirement list.
const WEB = process.env.WEB_URL || 'http://localhost:3000';
// Credentials are read from environment ONLY — never hardcoded in committed code.
const ADMIN_USER = process.env.ADMIN_USERNAME;
const ADMIN_PASS = process.env.ADMIN_PASSWORD;
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('ADMIN_USERNAME and ADMIN_PASSWORD environment variables are required.');
  process.exit(1);
}

async function check(name, fn) {
  try {
    const result = await fn();
    console.log(`${result ? '✅' : '❌'} ${name}: ${JSON.stringify(result)}`);
    return !!result;
  } catch (e) {
    console.log(`❌ ${name}: error ${e.message}`);
    return false;
  }
}

async function main() {
  const results = [];

  // 1. /generateapi requires authentication (key generation returns 401 unauthenticated)
  results.push(await check('Unauthenticated generate-key rejected (401)', async () => {
    const r = await fetch(`${WEB}/api/admin/generate-key`, { method: 'POST' });
    return r.status === 401;
  }));

  // 2. Incorrect credentials rejected (401)
  results.push(await check('Wrong admin credentials rejected (401)', async () => {
    const r = await fetch(`${WEB}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: 'definitely-wrong' }),
    });
    return r.status === 401;
  }));

  // 3-4. Correct login + server-side key generation
  results.push(await check('Correct admin login works (200)', async () => {
    const r = await fetch(`${WEB}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    return r.status === 200;
  }));

  let apiKey;
  results.push(await check('API key generated server-side', async () => {
    const login = await fetch(`${WEB}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    const r = await fetch(`${WEB}/api/admin/generate-key`, {
      method: 'POST',
      headers: cookie ? { Cookie: cookie } : {},
    });
    if (r.status !== 200) return false;
    const data = await r.json();
    apiKey = data.apiKey;
    // 5. key must look cryptographically random: rs_ + 43 base64url chars
    return /^rs_[A-Za-z0-9_-]{43}$/.test(apiKey);
  }));

  // 6. /api/sessions returns 401 for unauthenticated
  results.push(await check('Unauthenticated session creation rejected (401)', async () => {
    const r = await fetch(`${WEB}/api/sessions`, { method: 'POST' });
    return r.status === 401;
  }));

  // 11. Invalid API keys rejected
  results.push(await check('Invalid API key rejected (401)', async () => {
    const r = await fetch(`${WEB}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-key-123' },
    });
    return r.status === 401;
  }));

  // 3. Admin password not exposed in page HTML
  results.push(await check('Admin password absent from /generateapi HTML', async () => {
    const r = await fetch(`${WEB}/generateapi`);
    const html = await r.text();
    return !html.includes(ADMIN_PASS);
  }));

  // 12. API keys not returned by public endpoints
  results.push(await check('Public endpoints do not expose API keys', async () => {
    const ice = await fetch(`${WEB}/api/ice-servers`).then((r) => r.text());
    const pair = await fetch(`${WEB}/api/pair/nonexistent`).then((r) => r.text());
    return !ice.includes(apiKey || 'rs_') && !pair.includes(apiKey || 'rs_');
  }));

  // 6. QR contains no API key — create session and inspect QR content
  results.push(await check('Session QR contains only pairing token (no API key)', async () => {
    const r = await fetch(`${WEB}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.status !== 201) return false;
    const data = await r.json();
    const pairUrl = new URL(data.pairingUrl);
    const hasToken = pairUrl.searchParams.has('token');
    const hasApiKey = pairUrl.toString().includes(apiKey);
    return hasToken && !hasApiKey;
  }));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} security checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
# Remote Support — Consent-Based Real-Time Screen Sharing

A production-ready, consent-based remote support system. The PC operator authenticates,
generates an API key, creates a real session, a real QR code is displayed, the device
scans it, explicitly consents, and the **actual device screen** is streamed over
**real WebRTC** to the PC in real time.

**No mocks. No fake streams. No simulated connections.**

---

## ⚠️ Platform Limitation (Read First — This Is Not Faked)

**Mobile browsers (Android Chrome, iOS Safari) do NOT expose screen capture to web pages.**
The `getDisplayMedia` API is not available on mobile browsers. This is a hard platform
restriction imposed by Google and Apple — no web page can capture a phone screen.

| Platform | Screen Capture | Status |
|---|---|---|
| Desktop browser (Chrome, Edge, Firefox) | `getDisplayMedia` | ✅ Real, works |
| Android native app (included) | `MediaProjection` API | ✅ Real, works |
| Android Chrome / iOS Safari | — | ❌ Not supported by the platform |

The web consent page detects the missing API and clearly reports the limitation and
points to the native Android app instead. Nothing is faked.

---

## Architecture

```
                 /generateapi  (Admin Login → Generate API Key)
                 /             (Remote Support Dashboard — operator API key)
                      │
                 HTTPS / WSS
                      │
                      ▼
             NEXT.JS APP (Vercel)
             ├─ API Routes: sessions, QR, admin, ice-servers
             └─ PostgreSQL (sessions, api_keys)
                      │
               WebSocket Signaling Relay
              (separate Node.js process — see below)
                      │
                      ▼
              MOBILE DEVICE
        (native Android app OR desktop browser)
                      │
            REAL SCREEN CAPTURE
        (MediaProjection / getDisplayMedia)
                      │
                MediaStream → WebRTC
                      │
                      ▼
              PC LIVE VIEWER
```

### Vercel compatibility

- The **Next.js app** is fully Vercel-deployable: all REST API routes are Next.js route
  handlers, admin auth uses signed httpOnly cookies, and sessions/API keys live in
  PostgreSQL (external, e.g. Neon/Vercel Postgres).
- **WebSocket signaling** cannot run on Vercel's serverless platform. It is a separate
  small Node process (`packages/server`) that must be deployed on any always-on host
  (Railway, Render, Fly.io, a VPS, or alongside a Node runtime). It shares the same
  PostgreSQL database.

---

## Security Design

- **No default API keys.** The server fails securely with a clear configuration error if
  `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, or `SESSION_SECRET` are missing.
- **Admin login** (`/generateapi`) checks credentials **server-side only** against env
  variables. The password never reaches the browser bundle.
- **API keys** are generated server-side with `crypto.randomBytes(32)` (256-bit
  cryptographic randomness), returned **once** to the authenticated admin, and only the
  SHA-256 hash is stored in PostgreSQL.
- **QR codes** contain only a temporary pairing token with a 5-minute expiry. No
  credentials, no API keys.
- Each session issues a short-lived **wsToken** (stored hashed) used only to authenticate
  the operator's WebSocket to the signaling server. The API key itself is never sent to
  the signaling server.
- Expired/ended sessions reject reconnection.

---

## Quick Start (Local)

### Prerequisites
- Node.js ≥ 20
- A PostgreSQL database (Docker: `docker compose up -d postgres`, or any Postgres)
- A signaling server process (this project's `packages/server`)

### 1. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 2. Install dependencies and build

```bash
npm install
npm run build
```

### 3. Configure environment

Copy and fill in real values:

```bash
# packages/web/.env.local
DATABASE_URL=postgres://remote_support:remote_support_dev@localhost:5433/remote_support
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=YourStrongPassword
SESSION_SECRET=YourRandomSecret
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_WS_HOST=localhost:3001

# packages/server/.env
DATABASE_URL=postgres://remote_support:remote_support_dev@localhost:5433/remote_support
ALLOWED_ORIGINS=http://localhost:3000
```

### 4. Run

```bash
npm run dev:server   # signaling/WebSocket + ICE on :3001
npm run dev:web      # Next.js dashboard on :3000
```

---

### Local test flow

1. Open **http://localhost:3000/generateapi**
2. Log in with `Admin` / your configured `ADMIN_PASSWORD`
3. Click **Generate New API Key**, copy it
4. Return to the dashboard, paste the key
5. Click **Create QR Code**
6. On a **second desktop browser**, open the pairing URL (or scan the QR with a phone)
7. Consent screen appears → click **Allow Screen Sharing**
8. The **real browser permission dialog** appears → grant it
9. The PC dashboard shows **Device Connected → Screen Sharing Active** and the **real
   live screen** in real time
10. Click **Stop Session** — the device shows **Screen Sharing Ended**, the WebRTC
    connection closes, and the old token cannot reconnect

---

## Security Checks Implemented

| # | Requirement | Status |
|---|---|---|
| 1 | `/generateapi` requires authentication | ✅ Route handlers check httpOnly signed cookie |
| 2 | Incorrect credentials rejected (401) | ✅ Server-side env comparison |
| 3 | Admin password not in client JS | ✅ Only in server env + route handler |
| 4 | API key generated server-side | ✅ `crypto.randomBytes` in API route |
| 5 | Cryptographically random | ✅ 256-bit CSPRNG |
| 6 | Never in QR codes | ✅ QR contains only pairing token |
| 7 | Never committed to Git | ✅ `.gitignore` excludes `.env*` |
| 8 | No default API key remains | ✅ `requireEnv` fails without `DATABASE_URL` + no fallback |
| 9 | Unauthenticated cannot access operator APIs | ✅ 401 |
| 10 | Expired tokens rejected | ✅ signaling + route check expiry |
| 11 | Invalid API keys rejected | ✅ hash compare against DB |
| 12 | API keys not exposed by public endpoints | ✅ `/api/ice-servers` and `/api/pair` never return them |
| 13 | No production localhost dependency | ✅ `NEXT_PUBLIC_APP_URL` / `PUBLIC_BASE_URL` env-driven |
| 14 | Production build passes | ✅ `npm run build` |
| 15 | Vercel config valid | ✅ `next.config.mjs` serverless-compatible |

---

## Native Android App

Mobile browsers cannot capture screens. The included native Android app uses the real
`MediaProjection` API (`android/` directory, Kotlin, WebRTC, zxing QR scanner).

Build in Android Studio, set `signaling_base_url` in `strings.xml`
(`http://<PC-LAN-IP>:3001` for a physical device, `http://10.0.2.2:3001` for a emulator).

---

## Honesty Policy

This project **never** fakes a screen stream, simulates a connection, hardcodes
"Connected", pretends permission was granted, or uses placeholder video. Platform
limitations are reported honestly, and the correct supported architecture (native Android
app) is provided.
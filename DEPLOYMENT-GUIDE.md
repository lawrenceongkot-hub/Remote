# Deployment Guide (Taglish / Step-by-Step)

Gamitin ang guide na ito para i-deploy ang app sa Vercel at ma-configure ang lahat ng
environment variables.

---

## Kailangan mong malaman ngayon

Ang app ay **pumapayat** sa secure by design. Walang default na username/password/
database. Lahat sila ay nakabasa sa environment variables mo (server-side) — hindi
naka-embed sa code. Kaya kailangan mo itong i-set sa Vercel dashboard.

---

## STEP 1 — Buksan ang Vercel Environment Variables

1. Pumunta sa **https://vercel.com/dashboard**
2. I-click ang iyong project (hal. `remote` / `Remote`)
3. Sa **Settings** tab (button sa ibaba ng dashboard)
4. Sa kaliwang sidebar i-click ang **Environment Variables**

Dito ka mag-add ng recent taxes variables na ito.

---

## STEP 2 — ADMIN_USERNAME at ADMIN_PASSWORD

Ang iyong login para sa `/generateapi`:

| Variable | Value (gaya ng gusto mo) |
|---|---|
| `ADMIN_USERNAME` | `Admin` |
| `ADMIN_PASSWORD` | `Ryeon1121` |

Kaya: i-click **Add New**, type ang pangalam `ADMIN_USERNAME`, i-paste ang `Admin`,
piliin ang **Production** checkbox, i-click **Save**. Ulitin para sa `ADMIN_PASSWORD`.

> ⚠️ Huwag ito i-paste sa code o i-commit sa Git. Dito mo lang ito sa Vercel.

---

## STEP 3 — SESSION_SECRET (random secret)

Isang random string para ma-sign ang admin session cookie.

Kaya kung paano gumawa ng mahabang random string:

- Windows PowerShell:
  ```
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
- kopyahin ang result at i-set bilang `SESSION_SECRET`
- (hindi dapat pareho sa default na `local-dev-secret`)

---

## STEP 4 — DATABASE_URL (PostgreSQL connection string)

Ang system nangangailangan ng **real PostgreSQL database**. Meron kang duty na opsiyon:

### Opsyon A — Vercel Storage (pinaka-madali, may free tier)

1. Sa Vercel dashboard: i-click **Storage** (sa left sidebar)
2. I-click **Create Database** → piliin **Neon Postgres** (or **Vercel Postgres**)
3. Sundan ang wizard — no fee para sa free tier (0.5 GB etc.)
4. Paggawa na, i-click **Connect** / view the Connection Strings
5. May makikita kang **DATABASE_URL** (hal. `postgresql://user:password@...`) — kopy isyo

### Opsyon B — Neon na manual

1. Punta sa **https://neon.tech** → Sign up (GitHub/gupil)
2. **Create Project** → panig **PostgresQL**, region na malapit sa iyo
3. Sa **Connection Details**: i-copy ang **DATABASE_URL** na may `?sslmode=require`
   (Ito ay parang `postgresql://neondb_owner:...@ep-...pooler.../neondb?sslmode=require`)

Pagkatapos:

- Sa Vercel Environment Variables: **name = `DATABASE_URL`**, **value = i-yong connection string**
- I-click **Save**

> Lahat ng sessions, API-key hashes, at operators ay ito nasa database na ito.

---

## STEP 5 — NEXT_PUBLIC_APP_URL

Ito ay ang **URL ng iyong Vercel app**. Hanapin:

1. Vercel dashboard → iyong project
2. Sa **Overview** sa ibaba ng **Domains**, may URL ka gaya ng
   `https://remote-1a2b3c4d.vercel.app`
3. o **Settings → Domains** — ang unang nasa ganya roon

Sa Environment Variables:

- name = `NEXT_PUBLIC_APP_URL`
- value = `https://remote-1a2b3c4d.vercel.app` (bahala mo)
- Save

Ito ang ginagamit para gumawa ng QR pairing URL: `https://.../pair/SESSION?token=...`

---

## STEP 6 — NEXT_PUBLIC_WS_URL (signaling server)

⚠️ **Mahalaga:** Hindi maaaring tumakbo ang WebSocket signaling server sa Vercel
(serverless). Kailangan mo ng **always-on server** para sa signaling/WebRTC relay.

### Para sa matatag na option — Railway (Railway.app) (may free usage)

1. Punta sa **https://railway.app** → **Start a New Projekt** → **Deploy from GitHub**
2. Piliin ang repo na ito: `lawrenceongkot-hub/Remote`
3. Sa Railway **Project → New Service → Service → "Source: GitHub"** — o i-edit ang service
4. Ang `packages/server` ay ang signaling service. Railway mag-subdit ang:
   - **Root Directory** = `packages/server`
   - **Build Command** = `npm install && npm run build`
   - **Start Command** = `node dist/index.js`
   - **Port** = `3001`
5. Environment variables sa Railway:
   - `DATABASE_URL` = parehas na sa Vercel (PostgreSQL connection string)
   - `ALLOWED_ORIGINS` = `https://remote-1a2b3c4d.vercel.app`
   - `PORT` = `3001`
6. Pag-active na, hayaan ang service. Lalabas ang URL gaya ng:
   - `https://remote-production-XXXX.up.railway.app`
7. Sa Vercel Environment Variables:
   - name = `NEXT_PUBLIC_WS_URL`
   - value = `wss://remote-production-XXXX.up.railway.app/ws`
   - Save (hindi `wss:` para sa HTTPS deployed site)

> i-click setting: kung walang SSL/binding, pwede ring `ws://...` — ngunit sa production
> HTTPS site kailangan `wss://`.

---

## STEP 7 — Redeploy sa Vercel

1. Sa **Deployments** tab ng iyong project
2. I-click ang pinakabagong deployment → **... (menu) → Redeploy**
3. Hintayin ang build at deployment makumite

---

## STEP 8 — Test

1. Buksan ang `https://remote-1a2b3c4d.vercel.app/generateapi`
2. Login: kung/dispatay `Admin` at password Ryeon1121 (kung ginawa mo STEP 2)
3. Kung okusa makita ang "Configuration Required" muli, i-click **Redeploy** muli.

Pag-"Generate Your API Key" lalabas — dun ka kaydumarami API key.

---

## List of example varaibles (gaya ng pananabas)

```
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=Ryeon1121
SESSION_SECRET=<random-60-char-string>
DATABASE_URL=postgresql://...?sslmode=require
NEXT_PUBLIC_APP_URL=https://remote-1a2b3c4d.vercel.app
NEXT_PUBLIC_WS_URL=wss://remote-production-XXXX.up.railway.app/ws
```

---

## For local dev (gaya ngayon)

I-user ang local files (itaas/na naka commit):

- `packages/web/.env.local` → may `Admin` / `Ryeon1121`, `DATABASE_URL`
  `postgres://remote_support:remote_support_dev@localhost:5433/remote_support` (kung sa
  embedded PostgreSQL via `npm run db:start` sa `packages/server`)
- Run: `npm run dev:server` at `npm run dev:web`
- Bunka: **http://localhost:3000/generateapi** → login `Admin` / `Ryeon1121`

Ang embedded postgres ay aming development convenience — ang Vercel/hardware ay
gumunakan ng DATABASE_URL.
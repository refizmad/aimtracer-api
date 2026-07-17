# Coolify deploy — aimtracer (M6, primary)

**Layout (your approach):** one Coolify **Project** with three services on a shared network:

1. **web** — `aimtracer.com` (this monorepo package: `aimtrace/`)
2. **api** — public hostname e.g. `api.aimtracer.com` (`aimtrace-api/`)
3. **postgres** — private only (Coolify database resource)

**Worker:** Windows render PC (Steam + CS2). Not in Coolify. Outbound HTTPS → public API URL only.

Coolify handles HTTPS/proxy. You still fill secrets and point DNS.

---

## Network diagram

```
Browsers ──HTTPS──► web (aimtracer.com) ──HTTP internal──► api :5500
                         │                                    │
                         │                                    ▼
                         │                              postgres (internal)
                         │
Workers ──HTTPS───────► api (api.aimtracer.com)  ──► private S3 (presign/upload from worker)
 (Windows PC)                ▲
                             └── AIMTRACE_API + MACHINE_TOKEN
```

| Caller | Target | URL style |
|---|---|---|
| Next BFF (server) | api | **Internal** Coolify hostname, e.g. `http://api:5500` or `http://<coolify-api-service-name>:5500` |
| Browser / Steam OpenID return | web | `https://aimtracer.com` |
| Windows worker | api | **Public** `https://api.aimtracer.com` |
| api | postgres | Coolify `DATABASE_URL` (internal host) |

Do **not** put the worker on the internal network — it is a different machine. Do **not** publish Postgres to the internet.

---

## 1. Create the project

In Coolify:

1. New **Project** (e.g. `aimtracer`).
2. Add **PostgreSQL** resource (service name e.g. `postgres`). Note user/password/db name Coolify generates.
3. Add **Application** → aimtrace-api (name e.g. `api`).
4. Add **Application** → aimtrace (name e.g. `web` / domain `aimtracer.com`).
5. Ensure both apps and the database are on the **same Docker network** (default within a Coolify project/environment).

DNS:

- `aimtracer.com` (+ `www` if you want) → Coolify server (web service).
- `api.aimtracer.com` → Coolify server (api service).

---

## 2. Service: postgres

- Engine: Postgres 16 (Coolify default is fine).
- **No public port / no domain.**
- Copy the connection string Coolify shows for applications on the same network.

Typical shape (names vary by Coolify version):

```text
postgresql://USER:PASSWORD@postgres:5432/aimtrace?schema=public
```

Use the **hostname Coolify assigns** (often the service name). Paste into the API’s `DATABASE_URL`.

Backups: enable Coolify DB backups if available; otherwise schedule `pg_dump` from a one-off or the host (see `backup-pg.sh` for dump logic).

---

## 3. Service: api (`aimtrace-api`)

| Setting | Value |
|---|---|
| Source | Git repo → directory / base: `aimtrace-api` (or monorepo root with Dockerfile path) |
| Build pack | **Dockerfile** (recommended) → `Dockerfile` at repo root |
| Port | **5500** |
| Domain | `api.aimtracer.com` (HTTPS on) |
| Healthcheck | Prefer **`GET /health/ready`** (DB up); fallback `GET /health` |

**Node version (required):** Prisma 7 only supports **Node 20.19+ / 22.12+ / 24+**.  
If Coolify uses **Nixpacks** (auto-detect) instead of the Dockerfile, it may pick an older Node and fail at `npm ci` with:

```text
Prisma only supports Node.js versions 20.19+, 22.12+, 24.0+.
```

Fix in Coolify UI:

1. **Preferred:** Build Pack = **Dockerfile**, Dockerfile location = `/Dockerfile` (this repo).
2. **Or Nixpacks:** set Node to **22** (or env `NIXPACKS_NODE_VERSION=22`). Repo includes `nixpacks.toml`, `.nvmrc`, and `package.json` `engines.node`.

### Environment variables (api)

```env
NODE_ENV=production
PORT=5500

# From Coolify Postgres (internal host — not localhost)
DATABASE_URL=postgresql://…@<postgres-service>:5432/…?schema=public

# Steam OpenID allowlist = public WEB origin (not the API domain)
AUTH_RETURN_BASE_URL=https://aimtracer.com

ADMIN_TOKEN=<long random>
BOOTSTRAP_TOKEN=<same or separate>
CREDENTIALS_ENCRYPTION_KEY=<base64 32 bytes>
STEAM_WEBAPI_KEY=<steam web api key>

MATCH_HISTORY_POLL_ENABLED=false
MATCH_HISTORY_MAX_PAGES=15
MAX_AUTO_JOBS_PER_PLAYER_PER_DAY=10
MAX_GLOBAL_QUEUE_DEPTH=50
LEASE_VISIBILITY_TIMEOUT=300
MAX_LEASE_WAIT_SECONDS=25

# Private iDrive e2 — read keys for clip media presigns (ADR-0004)
S3_ENDPOINT_URL=https://….idrivee2….com
S3_BUCKET=aimtracer-clips
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_REGION=us-east-1
S3_PREFIX=clips
S3_PRESIGN_EXPIRY=3600
```

Generate secrets:

```bash
openssl rand -hex 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The image entrypoint runs `prisma migrate deploy` then starts the API. First deploy needs a reachable `DATABASE_URL`.

### After first successful api deploy

```bash
curl -fsS https://api.aimtracer.com/health
```

Worker token + friend invite are created in the **admin UI** (next section) — no curl.

**If Setup says `Cannot POST /admin/setup`:** the api container is still on an older image without that route. Redeploy the **api** service from the branch that includes `POST /admin/setup` (commit message like “one-shot admin setup”). Confirm in Coolify deploy logs / API swagger that `{/admin/setup, POST}` is registered.

---

## 4. Service: web (`aimtrace` / aimtracer.com)

| Setting | Value |
|---|---|
| Source | Git → `aimtrace/` (or monorepo + Dockerfile path `aimtrace/Dockerfile`) |
| Build | Dockerfile → `aimtrace/Dockerfile` (standalone Next) |
| Port | **3000** |
| Domain | `aimtracer.com` (and `www` redirect if desired) |

### Environment variables (web)

```env
NODE_ENV=production

# Prefer INTERNAL Coolify DNS to the api service (server-side BFF only).
# Replace "api" with the exact Coolify service name if different.
CLIPPER_BACKEND_URL=http://api:5500

# If internal DNS fails in your Coolify build, fall back to public:
# CLIPPER_BACKEND_URL=https://api.aimtracer.com

# Optional site URL for SEO/metadata if you use it
# NEXT_PUBLIC_SITE_URL=https://aimtracer.com

# Do NOT set NEXT_PUBLIC_CLIPPER_BACKEND_URL in production
```

Steam login flow: browser → `https://aimtracer.com/api/auth/steam/*` → API OpenID with `return_to` on the **web** origin. That is why `AUTH_RETURN_BASE_URL` on the API must be `https://aimtracer.com`.

Admin: open `https://aimtracer.com/admin`, enter the same `ADMIN_TOKEN` (stored in httpOnly cookie by the BFF; BFF calls api with `X-Admin-Token`).

---

## 5. Worker token (easy path — no curl)

The render PC is **not** invited. Setup only issues a **machine token**.

After **web** and **api** are healthy:

1. Open **`https://aimtracer.com/admin`**
2. Unlock with the same `ADMIN_TOKEN` as the api Coolify env
3. **Setup** tab → set public API URL if needed  
4. Click **Create worker token** → **Copy cmd block** → paste on the render PC in `cs2-clip`
5. Friend access: **Invites** tab → create invite link when you need one

### Even easier on the PC

```powershell
cd path\to\cs2-clip
powershell -ExecutionPolicy Bypass -File .\setup_worker.ps1
```

It prompts for API URL + admin token, runs `worker.py --register`, saves `worker_token.json`, and can start the lease loop. (`ADMIN_TOKEN` works as bootstrap token.)

Worker must:

- Reach **public** `https://api.aimtracer.com` (outbound 443)
- Keep local S3 write credentials (`s3_config.json` / `S3_*`)
- No inbound ports / not on Coolify network

Unattended service wrapper is **M7**.

---

## 6. Verification checklist

| # | Check |
|---|---|
| 1 | `curl -fsS https://api.aimtracer.com/health` and `/health/ready` (ready + database ok) |
| 2 | `https://aimtracer.com/admin` unlocks; **Setup** creates invite + worker |
| 3 | Invite link works (Steam login) |
| 4 | `/clips` gallery loads for a logged-in friend |
| 5 | Render PC worker leases (`/worker/jobs/lease` in api logs) |
| 6 | Postgres has **no** public domain |

---

## 7. Coolify tips

- **Redeploy order:** postgres healthy → api (migrates) → web.
- **Service name in `CLIPPER_BACKEND_URL`:** open the api service in Coolify and use the name shown for internal DNS (often the resource name). Port is the container port **5500**, not 443.
- **Long-poll leases:** worker `wait≈25s` — Coolify proxy timeouts are usually fine; if lease requests drop, raise proxy read timeout for the api service.
- **Secrets:** store in Coolify env UI; never commit `deploy/.env`.
- **Monorepo:** if both packages live in one git root, set each application’s **Base Directory** / Dockerfile path to `aimtrace` or `aimtrace-api`.

---

## 8. Fallback

If Coolify is down, `deploy/docker-compose.yml` + Caddy still describe a single-box layout. Prefer Coolify when it is how you operate the server.

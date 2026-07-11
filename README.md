# aimtrace-api

NestJS + Fastify backend for aimtracer clipper integration.

## Production deploy (M6)

See **[deploy/RUNBOOK.md](./deploy/RUNBOOK.md)** — docker-compose + Caddy + Postgres on a small VPS.

```bash
cp deploy/.env.example deploy/.env   # fill secrets on the VPS only
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Local Postgres for development remains:

```bash
docker compose up -d   # root docker-compose.yml → localhost:5432
```

## Friends-only auth (MVP)

Clip job routes and player features are **invite-only**. Steam OpenID is verified in this API; aimtrace holds an httpOnly session cookie and forwards `Authorization: Bearer` / `X-Session-Token`.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /auth/steam/begin` | — | Start OpenID (`inviteCode`, `returnTo`) |
| `POST /auth/steam/complete` | — | Verify OpenID, consume invite if new user, issue session |
| `GET /auth/me` | session | Current player |
| `POST /auth/logout` | session | Revoke session |
| `POST /admin/invites` | `X-Admin-Token` | Create invite codes |
| `GET /admin/invites` | `X-Admin-Token` | List invites |
| `GET/POST/DELETE /jobs` | session | Player-scoped jobs (`trustedSteamIds` forced to self) |

Env (see `.env.example`):

- `AUTH_RETURN_BASE_URL` — public web origin (e.g. `http://127.0.0.1:3000`)
- `ADMIN_TOKEN` — create invites
- `STEAM_API_KEY` — optional persona fetch after login

Create an invite:

```bash
curl -X POST http://127.0.0.1:5500/admin/invites \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"note":"for dave","maxUses":1,"expiresInDays":14}'
```

Share `https://your-site/invite/<code>` with friends. Seed also prints a local invite.

## Match history auto-clip

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET/PUT/DELETE /match-history` | session | Enroll / view / wipe credentials |
| `POST /match-history/disable\|enable\|reanchor\|poll-now` | session | Control + force poll |
| `POST /internal/match-history/poll` | admin | Poll all ACTIVE players |

Requires `STEAM_WEBAPI_KEY` + `CREDENTIALS_ENCRYPTION_KEY`. Set `MATCH_HISTORY_POLL_ENABLED=true` for the 10‑minute cron.

Enrollment is **anchor-as-cursor**: the known share code is not auto-enqueued; only newer codes are.

## Architecture (worker polling)

- Workers are external machines running the CS2 clipper (stateless render workers).
- Outbound HTTPS only. No inbound ports, no VPN, works behind CGNAT.
- Worker authenticates with a per-machine `X-Machine-Token`.
- Polling model (lowest complexity for low volume):
  - `GET /worker/jobs/lease` — claims the next available job (or long-poll).
  - `PATCH /worker/jobs/:id` — reports progress / completion / failure.
- Leasing, visibility-timeout and retry are implemented server-side with Postgres:
  - `SELECT ... FOR UPDATE SKIP LOCKED`
  - Leased jobs have `leaseExpiresAt`. Expired leases become available again (increment attempts).
  - Simple visibility timeout + max attempts.

## Job payload (for clip jobs)

```json
{
  "shareCode": "CSGO-...",
  "trustedSteamIds": ["7656..."],
  "options": {
    "minKills": 4,
    "minScore": 30,
    "limit": 0,
    "capture": "startmovie",
    "timescale": 1
  }
}
```

Worker runs roughly:
```
python clipper.py fetch <shareCode> --trusted <ids> [options from payload]
```
Then uploads results (S3 etc.) and reports back final URLs + metadata.

## Running (local dev)

```bash
# 1. Postgres (easiest)
docker compose up -d db

# 2. Configure
cp .env.example .env
# DATABASE_URL already matches the docker-compose default

# 3. Install + DB
npm install
npx prisma generate
npx prisma db push

# 4. Seed a dev worker (token printed). Add SEED_SAMPLE_JOB=1 for a test clip job.
npm run db:seed
# or: SEED_SAMPLE_JOB=1 npm run db:seed

# 5. Start
npm run start:dev
```

Then from another shell / machine:

```bash
# Option A: use the seed token
curl -H "X-Machine-Token: dev_machine_token_please_change" \
  "http://localhost:5500/worker/jobs/lease?wait=5"

# Option B: register a new real worker (if BOOTSTRAP_TOKEN set)
curl -X POST http://localhost:5500/bootstrap/worker \
  -H "X-Bootstrap-Token: $BOOTSTRAP_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"render-farm-01"}'
# → response contains the fresh machineToken — copy it to the worker

# Enqueue a test job (from web UI or script later)
curl -X POST http://localhost:5500/jobs \
  -H 'content-type: application/json' \
  -d '{"payload":{"shareCode":"CSGO-XXXXX-...","trustedSteamIds":["7656119..."]}}'
```

## Endpoints (worker)

- `GET /worker/jobs/lease?wait=30` → { job } | null
- `PATCH /worker/jobs/:id` body: `{ progress?, stage?, message?, status?, result?, error? }`

## Tech

- NestJS + Fastify
- Prisma + Postgres (explicit lease with SKIP LOCKED)
- No Bull / Redis / extra queue infra

This is the control plane. The clipper (cs2-clip) will be updated in a follow-up to become a worker client.

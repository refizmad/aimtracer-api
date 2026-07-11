# Production runbook (M6)

## Primary path: Coolify

**Use [COOLIFY.md](./COOLIFY.md).** One Coolify project:

1. **web** — aimtracer.com (`aimtrace/`)
2. **api** — api.aimtracer.com (`aimtrace-api/`)
3. **postgres** — private

Worker = Windows PC with Steam + CS2 → public `https://api…` only.

Env cheat-sheets: `coolify.env.api.example`, `coolify.env.web.example`, `coolify.env.worker.example`.

---

## Fallback: bare VPS docker-compose + Caddy

Only if you are not using Coolify. ADR-0001 primary is Coolify; compose remains supported.

This milestone ships the files; **you** provision infrastructure and paste real secrets. Agents must not use live credentials.

---

## 0. What you get in this repo (compose fallback)

| Path | Role |
|---|---|
| `Dockerfile` | Multi-stage Nest + Prisma image |
| `deploy/docker-compose.yml` | `db` + `api` + `caddy` (+ optional `backup` profile) |
| `deploy/Caddyfile` | HTTPS reverse proxy |
| `deploy/.env.example` | Production secrets template → copy to `deploy/.env` |
| `deploy/docker-entrypoint.sh` | `prisma migrate deploy` then start API |
| `deploy/backup-pg.sh` | `pg_dump` → `deploy/backups/` |
| `deploy/host-backup.cron.example` | Nightly cron snippet |

Local dev DB only remains at repo-root `docker-compose.yml` (Postgres on localhost:5432).

---

## 1. VPS checklist (you)

1. Create a small Linux VPS (Hetzner CX22 / DO 1–2 GB is enough for friends beta).
2. Point DNS: `API_DOMAIN` (e.g. `api.aimtracer.com`) **A/AAAA → VPS IP**.
3. Open firewall: **22**, **80**, **443** only (no Postgres port public).
4. Install Docker Engine + Compose plugin.
5. Clone this repo (or rsync) to e.g. `/opt/aimtrace-api`.

```bash
cd /opt/aimtrace-api
cp deploy/.env.example deploy/.env
nano deploy/.env   # fill every secret
```

Generate secrets on the VPS:

```bash
openssl rand -hex 32                    # ADMIN_TOKEN / BOOTSTRAP_TOKEN / SEED_WORKER_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # CREDENTIALS_ENCRYPTION_KEY
```

Set at minimum:

- `POSTGRES_PASSWORD`
- `ADMIN_TOKEN`
- `CREDENTIALS_ENCRYPTION_KEY`
- `STEAM_WEBAPI_KEY`
- `AUTH_RETURN_BASE_URL=https://aimtracer.com` (or your real web origin)
- `API_DOMAIN=api.aimtracer.com`
- `S3_*` read-only keys for private clip playback (ADR-0004)

Leave `MATCH_HISTORY_POLL_ENABLED=false` until worker + enrollment are proven (M8).

---

## 2. Deploy

```bash
cd /opt/aimtrace-api
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps
curl -fsS https://$API_DOMAIN/health
```

Expected health: `{"status":"ok",...}` (or equivalent from `/health`).

Logs:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f api caddy
```

Migrations run automatically on API container start (`prisma migrate deploy`).

---

## 3. Seed worker token + first invite

```bash
# From a machine that can reach the API (or docker exec into api):
export API=https://api.aimtracer.com
export ADMIN_TOKEN='…from deploy/.env…'

# Create invite
curl -sS -X POST "$API/admin/invites" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"note":"first friend","maxUses":1,"expiresInDays":30}'
# Share: https://aimtracer.com/invite/<code>

# Register worker (bootstrap) — or insert via seed
curl -sS -X POST "$API/bootstrap/worker" \
  -H "X-Bootstrap-Token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"render-pc","machineToken":"YOUR_LONG_WORKER_TOKEN"}'
```

On the **render PC**, point the worker at the public API (`cs2-clip/worker.py`):

```text
AIMTRACE_API=https://api.aimtracer.com
MACHINE_TOKEN=YOUR_LONG_WORKER_TOKEN
```

---

## 4. aimtrace (web) production env

On the Next host (Vercel / wherever aimtracer.com lives), set:

```env
CLIPPER_BACKEND_URL=https://api.aimtracer.com
```

Steam OpenID return is already the **web** callback (`/api/auth/steam/callback` on aimtracer.com). The API allowlist is `AUTH_RETURN_BASE_URL` on the API host — both must be the **public https web origin**, not the API domain.

Optional client-only (dev simulate worker; leave unset in prod):

```env
# NEXT_PUBLIC_CLIPPER_BACKEND_URL=   # do not set in production
```

Redeploy the Next app after changing env.

---

## 5. Backups

Local dumps into `deploy/backups/` (compose volume mount):

```bash
cd /opt/aimtrace-api
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm backup
ls -la deploy/backups/
```

Install nightly cron from `deploy/host-backup.cron.example`. Prefer also copying dumps to the private e2 bucket (`S3_BACKUP_PREFIX`).

Restore (break-glass):

```bash
gunzip -c deploy/backups/aimtrace-YYYYMMDD….sql.gz | \
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db \
  psql -U aimtrace -d aimtrace
```

---

## 6. Verification checklist (acceptance)

Do these yourself after DNS + secrets are live:

| # | Check | Pass? |
|---|---|---|
| 1 | `curl -fsS https://API_DOMAIN/health` returns OK | |
| 2 | `curl -fsS -H "X-Admin-Token: …" https://API_DOMAIN/admin/stats` returns JSON | |
| 3 | aimtracer.com `/clips` with a friend session loads against hosted API (no localhost) | |
| 4 | Steam login from invite still works (OpenID return_to allowlist) | |
| 5 | Render PC worker leases a job: API logs show `/worker/jobs/lease` from the worker | |
| 6 | Nightly backup dry-run produces a `.sql.gz` under `deploy/backups/` | |

M6 is **scaffolding + runbook complete** when the files above are in git. M6 is **live** only after the checklist is green on your VPS (you run that).

---

## 7. Ops notes

- **Do not** publish Postgres ports.
- Rotate `ADMIN_TOKEN` by changing `deploy/.env` and recreating the api container.
- Caddy renews certs automatically; if HTTPS fails, check DNS and ports 80/443.
- Scale assumption remains one worker, ≤15 friends — no Redis/k8s.
- After deploy, open `/admin` on aimtracer.com with the same `ADMIN_TOKEN` (BFF cookie) once `CLIPPER_BACKEND_URL` points at prod.

---

## 8. Rollback

```bash
# Previous image / git SHA
cd /opt/aimtrace-api
git checkout <previous-sha>
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

DB rollbacks need a restore from backup if a migration is not backward compatible — prefer forward fixes for friends beta.

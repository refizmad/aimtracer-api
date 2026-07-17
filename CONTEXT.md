# Context: aimtrace-api

A NestJS + Fastify backend that coordinates CS2 clip rendering across external worker machines. It owns the **job queue** and the **worker-polling protocol**; the heavy lifting stays in cs2-clip.

## Ubiquitous language

- **Job** — a unit of work for a worker, persisted in Postgres (`Job` model). Default `type` is `clip`. Carries an opaque `payload` (share code, trusted Steam IDs, render options) and its lifecycle state.
- **Job status** — the lifecycle enum: `PENDING` → `LEASED` → `PROCESSING` → `COMPLETED` / `FAILED` / `CANCELLED`.
- **Worker** — an external, stateless render machine running the cs2-clip worker. Identified by a row in the `Worker` model; authenticates per-request with a **machine token**.
- **Machine token** — the per-worker secret (`X-Machine-Token` header). The only credential a worker holds; validated by the worker-auth guard.
- **Lease** — the claim a worker takes on a job. A leased job records `leasedBy`, `leasedAt`, and a **lease expiry** (`leaseExpiresAt`).
- **Visibility timeout** — the window before a lease expires. An expired lease returns the job to available and increments `attempts`; after `maxAttempts` the job is failed.
- **Poll / long-poll** — the pull-based protocol: a worker calls `lease` to claim the next job (optionally holding the connection open) rather than the server pushing work.
- **Progress report** — a worker's `PATCH` updating `progress` (0–100), `stage`, `message`, and eventually `result` or `error`.
- **Bootstrap** — the unauthenticated setup surface (`bootstrap` module) used to register/seed a worker.

## Key protocol

- `GET /worker/jobs/lease` — worker claims the next available job. Server picks it with `SELECT … FOR UPDATE SKIP LOCKED`, sets status `LEASED`, stamps the lease.
- `PATCH /worker/jobs/:id` — worker reports progress / completion / failure.
- Job-creation endpoints under `jobs/` accept a clip request (share code + trusted Steam IDs + options) from the aimtrace frontend.

## Invariants

- **Outbound-only for workers**: no inbound ports; workers reach the API over HTTPS. Works behind CGNAT/NAT.
- Leasing is concurrency-safe via `FOR UPDATE SKIP LOCKED` — two workers never claim the same job.
- An expired lease is reclaimable and counts an attempt; `maxAttempts` bounds retries before `FAILED`.
- Every worker request is authenticated by a valid, enabled machine token.
- **A share code identifies a match, not a player**: enqueuing a code that already has a `PENDING` job merges the player into it (`enqueueClipForPlayer` — trustedSteamIds union via `withTrustedSteamId`, the player's Match row links the same job; `Match.jobId` is not unique) so one render serves everyone who played the game. The merge write is guarded on the job still being `PENDING`; once leased, the payload has been read, and a later player gets their own job (worker demo cache makes the re-download free).
- Job payloads carry only explicit per-job option overrides; parse/render tuning defaults are owned by the clipper (cs2-clip constants + `clipper_config.json`), so backend numbers can't silently drift from the tuned defaults.

## Auth (friends beta)

- **Player** — a Steam identity allowed to use the clip product. Created only via a valid **invite** on first Steam login (returning players need no invite).
- **Invite** — admin-created code (`POST /admin/invites` with `X-Admin-Token`). Friends-only; no public signup.
- **Admin surface** — `X-Admin-Token` guard (ADR-0003). Endpoints: `GET /admin/stats`, `/admin/jobs`, `/admin/players`, `/admin/workers`, `/admin/invites` (+ create). aimtrace BFF stores the token in an httpOnly cookie after `/api/admin/login`.
- **Session** — opaque token (`st_…`) stored hashed; aimtrace BFF holds httpOnly cookie and sends `Authorization: Bearer` / `X-Session-Token` to the API.
- **Steam OpenID** — verified in this API (`/auth/steam/begin`, `/auth/steam/complete`), not in the Next app.
- **Match history enrollment** — encrypted Steam match-history auth code + known share-code anchor. Status: `ACTIVE` / `DISABLED` / `INVALID_AUTH` (403) / `CHAIN_BROKEN` (412).
- **Poller** — `@Cron` every 10m when `MATCH_HISTORY_POLL_ENABLED=true`; walks `GetNextMatchSharingCode`, enqueues via `enqueueClipForPlayer` with `trustedSteamIds: [steamId64]`.

## Clips product (M2+)

- **Match** — a player's CS2 match keyed by share code (`Match` model; evolved from the old `MatchShareCode` discovery row). Lifecycle: `DETECTED` → `DOWNLOADED` → `RENDERED` / `FAILED`. `matchDate` is discovery/submit time for the beta (not yet demo-header time).
- **Clip** — a rendered highlight row (`Clip` model), upserted by `file` (mp4 basename = S3 object key / manifest dedup key) when a worker reports `COMPLETED`. Metadata (map, kills, type, score, …) comes from the clipper sidecar via `result.clips[]`.
- **Ingestion** — `ClipsService.ingestCompletedJob` runs as a non-fatal side effect of `PATCH /worker/jobs/:id` (job row remains source of truth). Each clip is attributed to its own player by sidecar `player_steamid` (`resolveClipOwnership` — a merged job renders several players' clips), and **all** matches linked to the job advance; stage reports past download advance them to `DOWNLOADED`.
- **Clip URL** — bucket stays private (ADR-0004). Durable identity is `Clip.file`. `GET /clips/:id/media` (session) mints a short-lived presigned GET via `S3MediaService` when `S3_*` is set; non-production falls back to `CLIP_MEDIA_DEV_FALLBACK_URL` so local UI works without real credentials. `Clip.url` may hold a worker-supplied URL that expires.
- **Clip list** — `GET /clips` (all friends, ADR-0002) and `GET /clips/mine` with filters (map, minKills, type, sort, pagination).
- **Match list** — `GET /matches/mine` returns the session player's matches only (map, date, status DETECTED→DOWNLOADED→RENDERED/FAILED, clip count, linked job), plus a status summary.

## Production (M6)

- **Coolify project** (primary, ADR-0001) — three services on one private network: **web** (aimtracer.com), **api** (public `api.*`), **postgres** (internal). BFF uses internal `http://api:5500`; Windows worker uses public `https://api…`.
- **Runbook** — `deploy/COOLIFY.md` (primary); compose+Caddy fallback in `deploy/RUNBOOK.md`.
- **Worker** — not hosted in Coolify; current Windows PC with Steam/CS2, outbound HTTPS only.
- **Backups** — Coolify DB backups and/or `deploy/backup-pg.sh`.
- **Logging** — Nest `Logger` + HTTP access interceptor (`method path status ms ip`); health probes quiet; 5xx via global exception filter. `LOG_LEVEL` for Fastify/pino.
- **Rate limiting** — `@nestjs/throttler` per client IP (`trustProxy`); default 120/min; tighter on auth/bootstrap; **skipped** for health and `/worker/*` paths only (not merely when `X-Machine-Token` is present).

## Related contexts

- **[[cs2-clip]]** — the worker process that leases and fulfils jobs (`worker.py`).
- **[[aimtrace]]** — the frontend that creates clip jobs.

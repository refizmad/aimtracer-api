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

## Auth (friends beta)

- **Player** — a Steam identity allowed to use the clip product. Created only via a valid **invite** on first Steam login (returning players need no invite).
- **Invite** — admin-created code (`POST /admin/invites` with `X-Admin-Token`). Friends-only; no public signup.
- **Session** — opaque token (`st_…`) stored hashed; aimtrace BFF holds httpOnly cookie and sends `Authorization: Bearer` / `X-Session-Token` to the API.
- **Steam OpenID** — verified in this API (`/auth/steam/begin`, `/auth/steam/complete`), not in the Next app.
- **Match history enrollment** — encrypted Steam match-history auth code + known share-code anchor. Status: `ACTIVE` / `DISABLED` / `INVALID_AUTH` (403) / `CHAIN_BROKEN` (412).
- **Poller** — `@Cron` every 10m when `MATCH_HISTORY_POLL_ENABLED=true`; walks `GetNextMatchSharingCode`, enqueues via `enqueueClipForPlayer` with `trustedSteamIds: [steamId64]`.

## Related contexts

- **[[cs2-clip]]** — the worker process that leases and fulfils jobs (`worker.py`).
- **[[aimtrace]]** — the frontend that creates clip jobs.

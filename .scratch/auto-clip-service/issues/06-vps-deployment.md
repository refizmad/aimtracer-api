# 06 — Production deployment on a small VPS (M6)

Status: resolved
Milestone: M6 (ROADMAP.md, workspace root)
Blocked by: 01
Decision: ADR-0001 amended — Coolify project (web + api + postgres); worker on Windows PC.
Note: Coolify runbook in deploy/COOLIFY.md; live cutover is operator-run (credentials).

## Scope

- docker-compose: API + Postgres; Caddy reverse proxy with HTTPS; production `.env` template (no secrets committed).
- Nightly `pg_dump` backup to the e2 bucket.
- Runbook: provision → DNS → deploy → seed worker token + first invite. User provisions the VPS and runs credential-bearing steps.
- aimtrace side: `CLIPPER_BACKEND_URL` + Steam OpenID return-URL allowlist updated to the hosted API.

## Acceptance

- A friend can log in on aimtracer.com from their own machine and load the clips gallery against the hosted API; the render PC leases a job over outbound HTTPS.

## Answer

Landed 2026-07-11; hosting approach updated same day to Coolify:

- **Primary:** `deploy/COOLIFY.md` — 3 services (web, api, postgres), shared network; Windows worker outbound HTTPS
- Env examples: `coolify.env.api|web|worker.example`
- Dockerfiles: `aimtrace-api/Dockerfile`, `aimtrace/Dockerfile` (Next `output: "standalone"`)
- Fallback compose+Caddy retained in `deploy/`

Live acceptance remains operator-run on Coolify.

## Comments

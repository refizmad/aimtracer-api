# 06 — Production deployment on a small VPS (M6)

Status: resolved
Milestone: M6 (ROADMAP.md, workspace root)
Blocked by: 01
Decision: ADR-0001 (small VPS, docker-compose, Caddy, outbound-only worker).
Note: scaffolding + runbook in git; live VPS checklist is operator-run (credentials).

## Scope

- docker-compose: API + Postgres; Caddy reverse proxy with HTTPS; production `.env` template (no secrets committed).
- Nightly `pg_dump` backup to the e2 bucket.
- Runbook: provision → DNS → deploy → seed worker token + first invite. User provisions the VPS and runs credential-bearing steps.
- aimtrace side: `CLIPPER_BACKEND_URL` + Steam OpenID return-URL allowlist updated to the hosted API.

## Acceptance

- A friend can log in on aimtracer.com from their own machine and load the clips gallery against the hosted API; the render PC leases a job over outbound HTTPS.

## Answer

Landed 2026-07-11 (scaffolding):

- `Dockerfile`, `deploy/docker-compose.yml` (db+api+caddy), `deploy/Caddyfile`
- `deploy/.env.example`, entrypoint migrate+start, backup script + cron example
- `deploy/RUNBOOK.md` full operator checklist
- `start:prod` fixed to `dist/src/main.js`
- aimtrace `.env.example` documents `CLIPPER_BACKEND_URL` for prod

Live acceptance (friend login + worker lease on real host) remains for the operator after VPS provision.

## Comments

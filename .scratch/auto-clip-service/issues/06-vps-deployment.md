# 06 — Production deployment on a small VPS (M6)

Status: open
Milestone: M6 (ROADMAP.md, workspace root)
Blocked by: 01
Decision: ADR-0001 (small VPS, docker-compose, Caddy, outbound-only worker).

## Scope

- docker-compose: API + Postgres; Caddy reverse proxy with HTTPS; production `.env` template (no secrets committed).
- Nightly `pg_dump` backup to the e2 bucket.
- Runbook: provision → DNS → deploy → seed worker token + first invite. User provisions the VPS and runs credential-bearing steps.
- aimtrace side: `CLIPPER_BACKEND_URL` + Steam OpenID return-URL allowlist updated to the hosted API.

## Acceptance

- A friend can log in on aimtracer.com from their own machine and load the clips gallery against the hosted API; the render PC leases a job over outbound HTTPS.

## Comments

# 09 — Production readiness track (P0–P6)

Status: claimed
Milestone: P (PRODUCTION-READINESS.md, ROADMAP.md)
Blocked by: —
Note: M7 explicitly deferred.

## Scope

Close the gap between “features exist in git” and “friends can use Coolify production safely.”

- P0 (code): prod env validation, readiness probe, CORS lockdown
- P1–P6: mostly operator Coolify/S3/worker (documented checklist)

## Acceptance

- Production API refuses to boot with missing secrets
- `/health/ready` reports DB (and S3 flag)
- Operator checklist in PRODUCTION-READINESS.md can be completed without rediscovering gaps

## Comments

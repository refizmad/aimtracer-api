# 05 — Admin stats + management API (M5, API side)

Status: open
Milestone: M5 (ROADMAP.md, workspace root)
Blocked by: 02
Counterpart: aimtrace GitHub issue "M5 (web)". Auth per ADR-0003 (existing X-Admin-Token guard).

## Scope

Admin-token-guarded endpoints:
- Totals: clips rendered, demos downloaded (matches DOWNLOADED+), storage usage (sum Clip.sizeBytes).
- Jobs by status with failure triage: error, attempts, logTail, source, player.
- Per-player activity: jobs/clips/matches counts, last activity, enrollment state.
- Worker health: last seen, current leased job, queue depth.
- Invites: existing create/list, plus which invite became which player.

## Acceptance

- Each panel of the admin dashboard has an endpoint returning correct numbers against seeded data; all reject a missing/wrong token.

## Comments

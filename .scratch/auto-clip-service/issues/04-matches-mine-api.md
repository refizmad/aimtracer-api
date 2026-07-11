# 04 — Matches API for the user dashboard (M4, API side)

Status: open
Milestone: M4 (ROADMAP.md, workspace root)
Blocked by: 02
Counterpart: aimtrace GitHub issue "M4 (web)".

## Scope

- Session-authenticated `GET /matches/mine`: the player's matches with map, date, status (DETECTED → DOWNLOADED → RENDERED / FAILED), clip count; joins existing job + enrollment data where useful.

## Acceptance

- Seeded player sees their matches with correct statuses; another player's matches never leak.

## Comments

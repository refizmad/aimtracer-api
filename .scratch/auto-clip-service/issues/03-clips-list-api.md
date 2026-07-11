# 03 — Clips list API (M3, API side)

Status: open
Milestone: M3 (ROADMAP.md, workspace root)
Blocked by: 02
Counterpart: aimtrace GitHub issue "M3 (web)".

## Scope

- Session-authenticated `GET /clips`: all players' clips (ADR-0002, all friends see all), filters (player, map, min kills, type), sort (date, kills, score), pagination.
- `GET /clips/mine` (or `?player=me`) for the "My clips" tab.
- Clip URLs are static public-bucket URLs stored at ingestion (ADR-0004) — no signing on read.

## Acceptance

- A valid session lists and filters clips across players; no session ⇒ 401. Verified against seeded fixture data.

## Comments

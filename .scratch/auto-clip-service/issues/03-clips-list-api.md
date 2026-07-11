# 03 — Clips list API (M3, API side)

Status: resolved
Milestone: M3 (ROADMAP.md)
Blocked by: 02

## Scope

- Session-authenticated `GET /clips` (all players — ADR-0002) with filters (player, map, min kills, type) + pagination.
- `GET /clips/mine`.

## Acceptance

- Logged-in friend can list all clips and own clips with filters.

## Answer

Landed 2026-07-11 with M1 media:

- `ClipsController`: `GET /clips`, `GET /clips/mine`, `GET /clips/:id`, `GET /clips/:id/media`
- Filters: player (steam64), map, minKills, type, sort (date|kills|score), order, page, pageSize
- `playUrl` points at BFF media path

## Comments

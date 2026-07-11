# 02 — Clip & Match models + worker result ingestion (M2, API side)

Status: resolved
Milestone: M2 (ROADMAP.md, workspace root)
Blocked by: 01
Counterpart: cs2-clip GitHub issue #2 — worker side landed (`d8d1be0`).

## Scope

- Prisma migrations: `Match` (player, shareCode, map, matchDate ≈ share-code `discoveredAt` / job `createdAt`, status DETECTED → DOWNLOADED → RENDERED / FAILED) and `Clip` (player, match, job, file, url, map, kills, headshots, type, clutch, round, score, durationS, sizeBytes, killEvents JSON).
- On a COMPLETED worker report (`PATCH /worker/jobs/:id`), ingest `result.clips[]` (now carrying full sidecar metadata + file size from the worker) into `Clip` rows; create/advance the `Match` row. Manual share-code jobs get a Match too. Backward-compatible with old `{file,url}`-only results (ingest what's there).
- Dev seed: fixtures built from real `cs2-clip/output/*.json` sidecars + `clips_manifest.json` — galleries/dashboards must render locally with zero renders, no real S3/Steam.
- First jest specs: ingestion service logic (pure, no DB mocking heroics — thin integration against dev Postgres is fine).

## Acceptance

- Simulated COMPLETED report with fixture data ⇒ `Clip` rows with map/kills/type/score and a `Match` with correct status.
- `npm test` passes; share-code submit on `/clips` still works.

## Answer

Landed 2026-07-11:

- Migration `20260711130000_match_and_clip_models` renames `match_share_codes` → `matches`, adds Match lifecycle columns + `clips` table.
- `ClipsService` ingests `result.clips[]` on COMPLETED; advances Match on stage/fail/lease-exhaust.
- Pure mapping tests: `src/clips/clip-ingest.util.spec.ts` (5 passing).
- Fixtures: `npm run db:seed:fixtures` (36 real sidecars). Sim script `scripts/sim-ingest.js` proves COMPLETED → Clip + Match RENDERED.
- ADR-0004 amended: bucket stays private; M1 is API presigns (not a blocker for this issue).

## Comments

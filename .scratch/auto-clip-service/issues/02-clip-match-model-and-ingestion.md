# 02 — Clip & Match models + worker result ingestion (M2, API side)

Status: open
Milestone: M2 (ROADMAP.md, workspace root)
Blocked by: 01
Counterpart: cs2-clip GitHub issue "M2 (worker)" — same milestone, contract change ships together.

## Scope

- Prisma migrations: `Match` (player, shareCode, map, matchDate ≈ share-code `discoveredAt` / job `createdAt`, status DETECTED → DOWNLOADED → RENDERED / FAILED) and `Clip` (player, match, job, file, url, map, kills, headshots, type, clutch, round, score, durationS, sizeBytes, killEvents JSON).
- On a COMPLETED worker report (`PATCH /worker/jobs/:id`), ingest `result.clips[]` (now carrying full sidecar metadata + file size from the worker) into `Clip` rows; create/advance the `Match` row. Manual share-code jobs get a Match too. Backward-compatible with old `{file,url}`-only results (ingest what's there).
- Dev seed: fixtures built from real `cs2-clip/output/*.json` sidecars + `clips_manifest.json` — galleries/dashboards must render locally with zero renders, no real S3/Steam.
- First jest specs: ingestion service logic (pure, no DB mocking heroics — thin integration against dev Postgres is fine).

## Acceptance

- Simulated COMPLETED report with fixture data ⇒ `Clip` rows with map/kills/type/score and a `Match` with correct status.
- `npm test` passes; share-code submit on `/clips` still works.

## Comments

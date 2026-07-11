# 01 — Git init + Prisma migrations baseline (M0)

Status: resolved
Milestone: M0 (ROADMAP.md, workspace root)

## Scope

- Extend `.gitignore` before anything else: add `logs/`, `.server-pid`; audit the tree for other stateful/secret files (`.env` is already ignored — verify).
- Scan the tree for credentials that must never be committed, then `git init` + initial commit.
- Baseline Prisma migrations from the current `schema.prisma` (no `prisma/migrations/` exists today — schema was only ever `db push`ed). All future schema changes go through `prisma migrate dev`.

## Acceptance

- `git log` shows an initial commit; `git status` clean; `.env`, `logs/`, `.server-pid` untracked.
- `prisma/migrations/` exists; `prisma migrate status` reports the dev DB in sync.

## Comments

**2026-07-11 — resolved.** `git init -b main`, two commits (3cd8766 initial, 897a3ee migrations baseline). `.gitignore` gained `/logs` and `.server-pid`; secret scan of the committable tree found nothing (seed/docker-compose use dev placeholders only). Baseline `20260711000000_init` generated via `migrate diff --from-empty` after confirming zero drift between the live dev DB and `schema.prisma`; `prisma migrate status` reports in sync. `.scratch/` is deliberately tracked (issue history, no secrets). Repo-local git identity set to match the sibling repos. Note: `npm test` currently exits with "no tests found" — first specs land with M2 ingestion per issue 02.

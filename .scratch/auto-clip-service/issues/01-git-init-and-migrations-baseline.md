# 01 — Git init + Prisma migrations baseline (M0)

Status: open
Milestone: M0 (ROADMAP.md, workspace root)

## Scope

- Extend `.gitignore` before anything else: add `logs/`, `.server-pid`; audit the tree for other stateful/secret files (`.env` is already ignored — verify).
- Scan the tree for credentials that must never be committed, then `git init` + initial commit.
- Baseline Prisma migrations from the current `schema.prisma` (no `prisma/migrations/` exists today — schema was only ever `db push`ed). All future schema changes go through `prisma migrate dev`.

## Acceptance

- `git log` shows an initial commit; `git status` clean; `.env`, `logs/`, `.server-pid` untracked.
- `prisma/migrations/` exists; `prisma migrate status` reports the dev DB in sync.

## Comments

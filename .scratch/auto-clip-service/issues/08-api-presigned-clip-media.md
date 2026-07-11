# 08 — API-issued presigned clip media (M1, API side)

Status: resolved
Milestone: M1 (ROADMAP.md, workspace root) — reframed after iDrive public-bucket refusal
Blocked by: 02
ADR: docs/adr/0004-public-bucket-clip-urls.md (private bucket + API presigns)
Counterpart: cs2-clip#1 (worker stays private/presign; no public ACL required)

## Scope

- Read-only S3 env on the API (`S3_ENDPOINT_URL`, `S3_BUCKET`, keys, optional prefix).
- Session-authenticated `GET /clips/:id/media` → 302 to a short-lived (~1h) presigned GET for `Clip.file`.
- Optional: attach a fresh signed URL on list responses for simple `<video src>` (M3).
- Dev never needs write access to the real bucket; fixtures remain non-playable bare URLs.

## Acceptance

- A logged-in session can play a private object via the media endpoint; anonymous cannot.
- Object is not world-readable (no public ACL).
- Unit/integration test of URL minting with a mocked S3 signer (no live bucket).

## Answer

Landed 2026-07-11:

- `S3MediaService` + `GET /clips/:id/media` (session) → short-lived presigned URL when `S3_*` set.
- Non-production dev fallback sample mp4 when S3 unset (`CLIP_MEDIA_DEV_FALLBACK_URL` / default sample).
- Unit tests in `s3-media.service.spec.ts`.
- aimtrace BFF: `GET /api/clips/:id/media` 302s to resolved URL (cookie auth, same-origin `<video src>`).

## Comments

# 07 — Zero-touch onboarding end-to-end + poller in production (M8, API side)

Status: open
Milestone: M8 (ROADMAP.md, workspace root)
Blocked by: 05, 06
Counterpart: aimtrace GitHub issue "M8 (web)"; depends on cs2-clip "M7" (unattended worker).

## Scope

- Enable `MATCH_HISTORY_POLL_ENABLED` in production; verify poller → job → worker → ingestion → gallery with a real friend.
- Poller/ingestion glue: Match status advanced by the poller (DETECTED on discovery), failure triage visible in admin.

## Acceptance

- The goal test: create an invite in /admin, friend logs in with Steam + enters auth code; their next played match appears as a rendered clip in the gallery with zero further actions by anyone.

## Comments

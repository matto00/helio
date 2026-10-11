# HEL-1301: e2e specs delete the throwaway users they create (exact id, not pattern)

## Description

origin_kind: followup
origin_ticket: HEL-1289 (related: HEL-1232, HEL-1440 items 2-3, HEL-1347)

e2e specs register throwaway users (`<prefix>-<ts>-<n>@example.test`) and never delete them. The HEL-1289 lane alone
left about 400 `hel1260-*` users in the shared dev DB, and the dev DB has historically been mostly gate residue.
Pattern deletion is forbidden in this repo, so after the fact these users can only be removed by exact id, and nobody
records the ids.

## Acceptance Criteria

- `registerAndLogin` (and any per-spec copies of it) records the created user's id, and the spec deletes that exact id
  in teardown or `finally`. Use an existing account-deletion API if there is one. If there isn't, add a minimal
  test-only path, but only after an owner ruling: do not ship a prod-reachable deletion route without one.
- Do not use cleanup by pattern, name or time window.
- Show the before and after counts of users created by a full e2e run that remain afterwards.
- Do not try to clean up existing residue here. That goes through the exact-id procedure in the dev-DB residue
  cleanup notes.

## Driver constraints (overnight queue, 2026-10-11)

- No new HTTP user-delete endpoint (security product surface). Test-only path, unreachable in prod.
- Deletion by exact recorded id only; a guard test proves the cleanup refuses anything but the run's recorded ids;
  the owner's real account must never be matched.
- Red first: a run leaves N users before the change and 0 after. E2E must still pass in CI (ephemeral DB) without
  slowing the shards.
- Never print `backend/.env`, `DATABASE_URL` or any credential.
- Existing residue is out of scope (read-only count only, follow-up).

## Why

Every e2e run leaves its throwaway users (and everything they own) in the shared dev DB: there is no user-delete API,
the harness never records the ids it creates, and pattern deletion is forbidden. The dev DB is ~99% test residue
(13058 of 13120 users carry an `@example.test`/`@example.com` address, read-only count 2026-10-11).

## What Changes

- Every e2e user registration (the shared `registerUser`/`registerAndLogin` helper, the remaining direct
  `POST /api/auth/register` call sites, and the UI-driven signup in `auth-cookie-migration`) records the created
  user's exact `{id, email}` in a per-run registry.
- A Playwright global teardown (wired in `playwright.config.ts`, inherited by the regression config) deletes exactly
  the recorded users, through a direct database connection resolved the way `e2e/support/historySeed.ts` already
  does it, in one transaction that aborts unless every recorded `(id, email)` pair matches exactly one row.
- A pure, unit-tested guard builds the deletion and refuses anything other than well-formed recorded ids (no
  pattern, name, or time-window predicate can be produced; the system user id is refused).
- A static check fails when an e2e file registers a user without recording it.
- No backend change: no route, no service, no migration.

## Capabilities

### New Capabilities

- `e2e-test-user-cleanup`: e2e runs delete the users they create, by exact recorded id, via a test-only path that
  does not exist in the product.

### Modified Capabilities

(none)

## Impact

- `e2e/support/` (auth helper, new registry/cleanup module, shared DB connection), Playwright configs, the direct
  register call sites in ~14 spec files, a new `check:` script + selftest wired into CI and pre-commit.
- CI e2e shards gain one `psql` call per shard at teardown (DB is ephemeral there; correctness check, not cleanup).

## Non-goals

- Deleting existing dev-DB residue (follow-up through the exact-id residue procedure).
- Deleting non-user leaks (pipelines/dashboards of users that survive) beyond what the user delete removes.
- Any prod-reachable deletion endpoint or account-deletion product feature.
- Changing FK `ON DELETE` behaviour of `users` references (HEL-1347 / HEL-1440 item 3 territory).

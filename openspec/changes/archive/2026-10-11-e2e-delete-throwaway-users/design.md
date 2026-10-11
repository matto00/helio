## Context

See proposal.md (Why). Ground truth gathered 2026-10-11 (premise-validation.md in the run evidence dir):

- `e2e/support/auth.ts` (HEL-1330) is the shared `registerUser`/`registerAndLogin`/`currentUserId` helper. It records
  nothing. 24 direct `POST /api/auth/register` call sites remain in 14 spec files (several quarantined in
  `playwright.config.ts` `testIgnore`), plus a UI-driven signup in `auth-cookie-migration.spec.ts` (~line 53) and
  `hel503`'s own `registerAndLoginWithDashboard` wrapper. The register response is `AuthResponse{expiresAt, user}`
  with `user.id` (`AuthProtocol.scala`).
- No user-delete route/service/repository exists in the backend.
- `e2e/support/historySeed.ts` already talks to the DB with `psql`, resolving `DATABASE_URL`/`DB_USER`/`DB_PASSWORD`
  from the environment, falling back to the worktree's `backend/.env`; it runs in CI (hel1275/hel1350/hel1331), so
  `psql` is present on the CI runner. Its error path interpolates the execFileSync error, whose message embeds the
  psql argv (the connection URL) - a credential-leak shape this change must not copy.
- Live FK catalog to `users`: CASCADE for agent_memory, agent_preferences, api_tokens, connector_completion_tokens,
  connector_credentials, connectors, data_sources (V119), image_uploads (V119), mfa_*, product_events,
  resource_permissions, share_tokens, user_dashboard_zoom, user_mfa, user_sessions. NO ACTION (blocks a bare user
  delete): alert_events, alert_rules, assistant_conversations, assistant_daily_usage, authoring_conversations,
  dashboards, invite_codes, outputs, panels, patch_set_applications, pipeline_run_rate_window, pipelines. Matches
  `docs/user-reference-inventory.md`. `connectors.credential_id -> connector_credentials` is RESTRICT.
- CI e2e: 4 shards x 2 workers, ephemeral `postgres:16` service, superuser `helio` (RLS bypassed); dev DB likewise
  bypasses RLS as the local superuser.

## Goals / Non-Goals

**Goals:** every user an e2e run creates is gone when the run ends; deletion is provably exact-id-only; zero product
surface; no credential output; negligible CI cost.

**Non-Goals:** residue already in the dev DB; FK `ON DELETE` changes; orphan rows with no FK to users
(`node_snapshots`, `audit_events`) - follow-ups.

## Decisions

**D1 - Test-only DB path, not an HTTP endpoint.** The cleanup runs in the Playwright process via `psql`, the
mechanism `historySeed.ts` already uses. Rejected: a dev-profile-gated test-support route (still compiled into the
prod artifact; its absence in prod needs its own proof and it is a security product surface the ticket says needs an
owner ruling); an account-deletion feature (product scope). This is still "a minimal test-only path", which the
ticket ties to an owner ruling, so it ships as an assumed, reversible product call: the PR carries an
"OWNER REVIEW: assumed product call(s)" section and is not agent-merged.

**D2 - Per-run registry + global teardown.** `globalSetup` creates a fresh per-run directory under a gitignored
`<worktree>/.e2e-user-registry/<runId>/` and exports its path in an env var (workers inherit env set in globalSetup).
Each successful (201) registration appends one JSON line `{id, email}` - both taken from the response body's `user`,
including for the UI signup (via the observed register response or `/api/auth/me`) - to a per-worker file
(`appendFileSync`, one small write). globalSetup always creates a fresh directory and refuses a non-empty one.
`globalTeardown` reads only that directory, deletes, and removes the directory on success; on failure it leaves the
directory (ids recoverable by exact value) and throws so the run reports it. Recording with no registry env set
throws (fail closed: no unrecorded users). Wired once in `playwright.config.ts`; `playwright.regression.config.ts` spreads the base config and inherits it
(Playwright 1.55.1; verify, do not duplicate). Rejected: per-test `afterEach` fixture (needs every spec's `test` import changed, N psql calls
instead of one, and deletes while sibling assertions may still use the session); a sweep of leftover registries from
earlier runs (could delete a concurrently running run's users in the same worktree).

**D3 - One transaction, exact `(id, email)` guard.** The builder emits: `BEGIN`; a temp table of the recorded
`(id, email)` pairs; an assertion that `count(users JOIN doomed ON id AND email)` equals the recorded count (else
`RAISE EXCEPTION` - aborts, nothing deleted); `SELECT ... FROM users WHERE id IN (SELECT id FROM doomed) FOR UPDATE`
so a late backend write referencing a doomed user (auto-run debounce, scheduled/in-flight run, rate-window row) waits
for the commit and fails on the backend side instead of aborting the teardown; deletes of the NO ACTION children `WHERE <owner col> IN (SELECT id FROM
doomed)` in dependency order (alert_events, alert_rules, panels, outputs, dashboards, pipelines, connectors,
patch_set_applications, authoring_conversations, assistant_conversations, assistant_daily_usage,
pipeline_run_rate_window, invite_codes); `DELETE FROM users WHERE id IN (SELECT id FROM doomed)` with its row count
asserted equal to the recorded count; `COMMIT`. Users are selected only by `id`; email is a second equality check,
never a selector. A newly added NO ACTION FK makes the teardown fail loudly instead of silently leaving residue.

**D4 - Pure builder with a strict input contract.** Ids must match the canonical UUID regex; the system user
`00000000-0000-0000-0000-000000000001` is refused; any email whose domain is not an e2e throwaway domain
(`example.test`, `example.com`) is refused, and the SQL repeats that refusal plus `email <> 'matt@helio.dev'` (the
owner account literal `setUserTierForTest` already guards against) so the owner's real account can never match; duplicates and empty input are refused (empty registry = no psql
call at all, not an error); emails must be plain addresses with no quote, backslash, whitespace or control character
(values are interpolated only after this validation). A selftest (run in CI and pre-commit) asserts the refusals,
asserts the SQL contains only the recorded literals, that teardown reads only its own run directory (a sibling run
dir's ids never appear in the SQL), and no `LIKE`/`ILIKE`/`~`/`SIMILAR`/`now()`/`interval`
predicate, and is shown failable by mutation.

**D5 - Shared, non-leaking DB connection.** Extract the env/`backend/.env` resolution from `historySeed.ts` into
`e2e/support/db.ts` used by both; its error wraps only psql's stderr (bounded), with the resolved URL, user and password scrubbed from it - never the
argv/URL/password. A probe forces a psql failure with a sentinel URL and password and asserts neither appears in the
thrown or logged output; it goes red when the old `${e}` interpolation is restored. Nothing
is ever logged about the connection.

**D6 - Static check.** `check:e2e-user-cleanup` (+ selftest) fails, naming the file, when an e2e source file posts to
`/api/auth/register` or drives the signup form without calling the recorder; wired in CI next to
`check:e2e-evidence-paths` and in `.husky/pre-commit` (CI/pre-commit parity is itself checked).

**D7 - Before/after measurement (read-only).** Before (base commit) and after (branch): snapshot the set of user ids,
run the full e2e suite (2 workers, `nice -n 19`), snapshot again; report the exact set difference, attributing rows
to this run by the exact emails the run logged/recorded, and noting concurrent-lane noise. Never a pattern delete.

## Risks / Trade-offs

- [Run killed before teardown (SIGKILL, CI timeout)] -> registry dir stays on disk with exact ids; CI DB is
  ephemeral anyway. Documented in e2e/README.md.
- [Backend writes a row for a doomed user after its lock] -> the late write waits on the row lock and then fails
  with an FK error logged by the backend (e2e-only noise); the teardown itself commits.
- [Deleting a user cascades to rows another test user references via a grant] -> e2e-only data; acceptable.
- [Teardown failure turns an otherwise-green CI shard red] -> intended: it means residue or a new blocking FK.
- [Non-superuser local DB_USER under FORCE RLS] -> deletes match 0 rows, count assertion fails loudly, no partial
  delete.

## Gate-Chain Implications Checklist

- **What does it execute?** `.husky/pre-commit` gains `npm run check:e2e-user-cleanup` and its selftest: two node
  scripts that read files under `e2e/` and (selftest) temp fixtures; no DB, no network.
- **What environment does it inherit, and from where?** The committer's shell env via husky; reads no env vars.
- **Does it write anything outside its own sandbox?** The selftest writes only into an `mkdtemp` dir under the OS
  temp dir and removes it (same pattern as `check-e2e-evidence-paths.selftest.mjs`).
- **Does it behave differently from a linked worktree than from a main checkout?** No: paths resolve from the
  script's own location, not cwd or `.git`.
- **What happens on its first run?** It scans the current tree; it passes once every register site records.

## Planner Notes

- Self-approved: global teardown over per-test fixture (D2); psql over a new JS dependency (D1/D5, precedent).
- Assumed product call (owner review, reversible): D1's test-only DB path in place of an owner-ruled route.

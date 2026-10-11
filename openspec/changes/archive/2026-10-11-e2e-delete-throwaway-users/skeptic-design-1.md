## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 38acc608331e9dcf84127cf9ada4e035a460a0e2 (change dir untracked; artifacts: ticket.md, proposal.md,
design.md, tasks.md, specs/e2e-test-user-cleanup/spec.md).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/e2e-delete-throwaway-users/HEL-1301`.
- **Installed Playwright is 1.55.1** (`/home/matt/Development/helio/node_modules/playwright/package.json`; the worktree
  has no root node_modules and resolves up to the main checkout's).
- **globalSetup env reaches workers: TRUE.** `playwright/lib/runner/testRunner.js:383-391`: global setup tasks run
  in the runner process before the run-tests tasks; `runner/processHost.js:53-58` forks each worker with
  `env: {...process.env, ...extraEnv}`, so an env var set in globalSetup is inherited by every worker.
- **globalTeardown runs after failed tests and after SIGINT: TRUE.** `runner/tasks.js:99-108,180-191`: the
  teardown file becomes a task with only a `teardown` step; `runner/taskRunner.js:43-97` runs the teardown runner
  even when status is failed or interrupted (`sigintWatcher.hadSignal()` -> "interrupted", then
  `teardownRunner.runDeferCleanup`). SIGKILL/CI timeout is not covered, as the design's Risks already say.
- **`playwright test --list` does not run globalSetup/Teardown** (`testRunner.js:383-386`), so `scripts/e2e-shard.mjs`'s
  two `--list` calls per leg add no psql call; the one real `playwright test` spawn per leg (`e2e-shard.mjs:254`)
  runs teardown once. CI cost claim (one psql per shard) holds.
- **CI env:** `.github/workflows/ci.yml:540-543` sets `DATABASE_URL`/`DB_USER`/`DB_PASSWORD` at job level for the e2e
  job; ephemeral `postgres:16` service. The teardown's connection resolution will work there.
- **Regression config:** `playwright.regression.config.ts` is `{...baseConfig, testIgnore: filtered}`, so
  globalSetup/globalTeardown set in the base config are inherited automatically.
- **FK graph (live, read-only `pg_constraint` query with `default_transaction_read_only=on`):** the 12 NO ACTION
  (`a`) FKs to `users` are exactly alert_events, alert_rules, assistant_conversations, assistant_daily_usage,
  authoring_conversations, dashboards, invite_codes, outputs, panels, patch_set_applications,
  pipeline_run_rate_window, pipelines — D3's list covers all 12. `connectors.credential_id -> connector_credentials`
  is RESTRICT (`r`); D3 deletes `connectors` explicitly before the users delete, so the users cascade into
  `connector_credentials` meets no referencing connector. `pipeline_steps.parent_step_id` self-FK is NO ACTION
  but is end-of-statement checked and fully removed by the pipelines/pipeline_roots cascade. No other NO ACTION/
  RESTRICT edge into any table D3 deletes from. D3's order is sufficient.
- **Triggers:** the only non-internal trigger on the touched tables is `hel1456_strip_deleted_panel_layout_items_trigger`
  (AFTER DELETE ON panels, statement-level, rewrites `dashboards.layout`); it cannot raise and is harmless here.
- **`invite_codes` columns** are `id, code_hash, user_id, created_at, redeemed_at` — `user_id` is the redeemer, so
  D3 deletes the invite-code row a test user redeemed. Acceptable for e2e data.
- **Credential-leak shape confirmed:** `e2e/support/historySeed.ts:49-58` passes the URL as psql argv and throws
  `` `...: ${e}` ``; execFileSync's error message embeds the full argv. D5 correctly identifies and replaces it.
  historySeed already uses `ON_ERROR_STOP=1` and `PGPASSWORD` env, which the shared db.ts will keep.
- **Precedent for an owner-account refusal exists:** `historySeed.ts` `setUserTierForTest` adds
  `AND email <> 'matt@helio.dev'` in SQL.
- **Call sites:** `grep` over `e2e/` confirms direct `/api/auth/register` callers in the 14 files the premise lists
  (incl. quarantined ones), the UI signup at `auth-cookie-migration.spec.ts:46-57` (its 201 body already carries
  `user.id`), and 45 files using the shared helpers. Emails are generated lowercase by `uniqueEmail`.
- **"the spec deletes that exact id in teardown or finally":** a run-level globalTeardown deleting exactly the
  recorded ids satisfies the AC's intent (exact id, deleted in a teardown). D2's rejection of per-test fixtures is
  reasoned. Accepted as a design judgment; it is surfaced in the PR's owner-review section anyway.
- **Test-only psql path as an assumed product call:** sound. No backend route/service/migration, nothing compiled
  into the prod artifact, same mechanism as an already-shipped test helper, reversible, and flagged for owner
  review with no agent merge.

### Verdict: REFUTE

The design is mostly sound and the hard questions (env propagation, teardown on failure/SIGINT, FK order,
RESTRICT edge, CI cost) check out against ground truth. Three gaps need closing in the artifacts before execution;
each is small.

### Change Requests

1. **The driver constraint "the owner's real account must never be matched" has no guard.** D4 refuses only the
   system user id. Exact-id selection makes a match unlikely, but nothing refuses it if a registry line ever holds
   a non-throwaway account (a spec recording after a login, a hand-edited/left-over registry file, a future helper
   misuse). Add to D4/D3, the spec, and tasks 2.2/4.1: the builder refuses any record whose email domain is not
   one of the e2e throwaway domains actually used (`example.test`, `example.com` — an allowlist used as a refusal
   filter, never as a selector), and the SQL carries the same refusal (e.g. the guard assertion fails if any doomed
   row's email is outside those domains, plus `email <> 'matt@helio.dev'` mirroring `setUserTierForTest`). Add a
   selftest case per refusal and include it in the 4.1 mutation proof. Also state in D2/tasks how the guard test
   proves teardown reads only its own run directory (the second half of the same driver constraint): e.g. a
   selftest with a sibling run dir present whose ids must not appear in the produced SQL.

2. **Race with the still-running backend can turn a CI shard red intermittently.** Teardown runs immediately after
   the last test while the backend is still live; scheduler-tick work (dataset-write auto-run debounce, scheduled
   runs, in-flight pipeline runs) can insert rows that reference a doomed user (e.g. `pipeline_run_rate_window`,
   `pipelines`-owned runs) between D3's child deletes and the `DELETE FROM users`, which then fails its NO ACTION
   check and aborts the whole teardown. Given this repo's history of quarantining intermittently red specs, specify
   in D3 that, right after the `(id, email)` assertion, the transaction locks the doomed users rows
   (`SELECT ... FROM users WHERE id IN (SELECT id FROM doomed) FOR UPDATE`) so concurrent FK inserts block on the
   key-share lock and fail on the backend side after commit instead of failing the teardown. Note the residual
   behaviour (backend logs an FK error for that late write) in Risks.

3. **The spec scenario "Connection failure does not leak credentials" has no verifying task.** Tasks 2.1/4.4 only
   check that types and a historySeed spec pass. Add a task (selftest or scripted probe) that forces a psql failure
   with a sentinel URL and sentinel password (e.g. unreachable host / bad password) and asserts the thrown message
   and anything logged contain neither sentinel, shown failable by mutation (re-introduce `${e}`). Also specify in
   D5 that the bounded stderr is scrubbed of the resolved URL/user/password values before wrapping (psql stderr can
   echo parts of a conninfo for malformed URIs), so the guarantee does not rest on psql's message wording.

### Non-blocking notes

- Record `user.id` **and `user.email` from the 201 response body** (and for the UI signup, from the captured
  register response rather than an extra `/api/auth/me` call) so the recorded email is the server's stored value,
  not the requested one.
- `playwright.regression.config.ts` already inherits `globalSetup`/`globalTeardown` through `...baseConfig`;
  re-wiring them there is a hand-copied duplicate that file's own header argues against. Prefer relying on the
  spread and asserting it in the type/selftest.
- `auth-cookie-migration.spec.ts`'s login test posts to `/api/auth/register` without asserting 201; record only on
  a 201 (the registry must never get a line for a failed registration).
- globalSetup should refuse a pre-existing non-empty run dir and should not honour an externally pre-set registry
  env var (always create its own fresh dir).
- Task 1.1/4.3 run the full suite twice on a machine shared with four lanes; keep the stated 2 workers +
  `nice -n 19`, and do not run them concurrently with another lane's full e2e.

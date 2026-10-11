## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 38acc608331e9dcf84127cf9ada4e035a460a0e2 (change dir untracked; artifacts: ticket.md, proposal.md,
design.md, tasks.md, specs/e2e-test-user-cleanup/spec.md, plus skeptic-design-1.md).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/e2e-delete-throwaway-users/HEL-1301`.
- **Round-1 CR1 (owner/non-test account + cross-run isolation): addressed.** D4 now refuses any email outside
  `example.test`/`example.com`, and the SQL repeats that refusal plus `email <> 'matt@helio.dev'`. Spec scenarios
  "Non-test account refused" and "Another run's registry is ignored" were added, and task 4.1's mutation list now
  covers the domain/owner refusal (builder and SQL) and own-run-dir isolation. Ground truth: a grep of every email
  literal in `e2e/` (excluding imports) finds only `@example.test`/`@example.com`, apart from the `matt@helio.dev`
  guard itself in `historySeed.ts:104,110`. So the allowlist breaks no existing call site, and the owner literal
  matches the existing precedent.
- **Round-1 CR2 (late backend writes): addressed.** D3 now runs `SELECT ... FOR UPDATE` on the doomed users rows
  after the `(id, email)` assertion and before the child deletes. FOR UPDATE conflicts with the FOR KEY SHARE that
  Postgres RI triggers take on the referenced row, so a concurrent insert of a child row waits and then fails on
  the backend side. (FOR NO KEY UPDATE would not have worked, and the design avoids it.) Risks records the
  residual backend FK error. Task 4.1 includes "FOR UPDATE lock present" in the mutation proof.
- **Round-1 CR3 (credential leak): addressed.** D5 now scrubs the resolved URL, user and password from bounded
  stderr, and requires a sentinel probe that goes red when the `${e}` interpolation comes back. Task 4.5 covers
  it. Ground truth: `historySeed.ts:50` passes the URL as psql argv and `:57` throws with `${e}`, which is the
  leak shape D5 targets.
- **FK graph re-derived (read-only catalog query, `default_transaction_read_only=on`):** the 12 NO ACTION FKs into
  `users` are exactly dashboards, panels, pipelines, alert_rules, alert_events, authoring_conversations,
  patch_set_applications, assistant_conversations, outputs (all `owner_id`), and assistant_daily_usage,
  invite_codes, pipeline_run_rate_window (all `user_id`). Each table has one user column, so D3's
  "WHERE <owner col> IN doomed" is unambiguous. All 16 other FKs are CASCADE.
- **No blocking edges into D3's target tables:** the only NO ACTION/RESTRICT FKs into
  {D3 tables, connector_credentials, data_sources, pipeline_steps, pipeline_roots, node_snapshots, pipeline_runs}
  are `pipeline_steps.parent_step_id` (self, removed in the same cascade) and
  `connectors.credential_id -> connector_credentials` (RESTRICT). D3 handles the second by deleting `connectors`
  explicitly before the users delete. D3's order is sufficient.
- **User-creation paths are fully enumerated:** the backend's user-creating routes are `auth/register` and
  `auth/google/callback` (`AuthRoutes.scala:39`, `OAuthRoutes.scala:112`). The only e2e use of the Google
  callback (`auth-cookie-migration.spec.ts:137`) is fully stubbed with `page.route("**/api/**")`, so it creates no
  real user. The direct `/api/auth/register` files match the 14 in the premise, plus `support/auth.ts`. The UI
  signup at `auth-cookie-migration.spec.ts:46-57` already captures the 201 response, so its `user.id`/`user.email`
  can be recorded from it.
- **Wiring targets exist:** `check:e2e-evidence-paths` is at `package.json:39-40`, `ci.yml:129-130` and
  `.husky/pre-commit:22-23`, which is where D6 places the new check. Neither Playwright config currently sets
  `globalSetup`/`globalTeardown`/`webServer`, so there is nothing to conflict with.
- **Ticket coverage:** exact-id recording and deletion (D2/D3, tasks 2.2-3.1). No pattern/name/time predicate
  (D4 plus the selftest's forbidden-token check). Before/after counts (tasks 1.1/4.3). Residue out of scope (C4).
  No HTTP endpoint (D1/C3). The test-only path is an owner call that is assumed and flagged, and parks for owner
  review (workflow-state `OWNER_REVIEW_ASSUMED_CALL`). Red first (1.1, 1.2). CI cost: one psql per shard,
  confirmed in round 1.
- **Placeholders/contradictions:** none found that would block implementation.

### Verdict: CONFIRM

### Non-blocking notes

- Set a `lock_timeout` (or `statement_timeout`) inside the teardown transaction. Then a backend transaction that
  holds a KEY SHARE lock for a long time makes the teardown fail loudly within seconds, instead of hanging the
  shard until the CI job timeout.
- Task 3.1 says the UI signup records "via `/api/auth/me`". The spec already awaits the 201 register response
  (`auth-cookie-migration.spec.ts:51-58`), so record from that body, as D2 also allows. That matches what the
  server stored and avoids an extra call.
- The D6 "drives the signup form" detection is the vaguest part of the static check. Pin it to a concrete
  signal, such as `page.goto("/register")` or a submit on the register form, and give it a selftest fixture.
- Task numbering: 4.5 sits between 4.1 and 4.2 (cosmetic).

## Evaluation Report — Cycle 1 (evaluation-1.md)
Reviewed head_sha: 2561ccdb037f7e5912fd174e51cbca0fd09f67b0

### Phase 1: Spec Review — PASS
Issues: none. All four ACs addressed: backfill of signup_completed at occurred_at=created_at, empty properties, ON CONFLICT DO NOTHING on uq_product_events_once_per_user, first_dashboard_rendered not backfilled, red-first non-superuser proof with rows. Rollup consequence (non-NULL rolled_through lowered) goes beyond the literal ticket but is within its "verify rollup rolls history" instruction and is documented in design.md. Tasks all ticked and match.

### Phase 2: Code Review — PASS
Gate (own fresh run): `cd backend && nice -n 19 sbt testFull` -> 5239 tests, 0 failed, 364 suites, none aborted. No known flakes (HEL-1228/1225, HEL-1215) occurred this run. Frontend gates not applicable (no frontend files changed).

Independent verification (throwaway detached worktree at 2561ccdb, mutations of V114 run against V114BackfillSignupEventsSpec, worktree removed afterwards):
- Red-first: naive `INSERT ... SELECT FROM users` under the NOSUPERUSER NOBYPASSRLS role fails with SQLSTATE 42704 ("unrecognized configuration parameter app.current_user_id"). Removing the `set_config` from V114 makes the Flyway migration itself fail with 42704 (2 of 3 tests fail). So the real migration is genuinely dependent on the per-user context.
- No-leak: changing set_config is_local true->false fails the main test (leak assertion). Failable.
- Idempotency / no duplicate own row: removing ON CONFLICT makes the migration fail on the pre-existing signup row (2 of 3 tests fail). Failable.
- Rollup mark: replacing the `rolled_through = earliest_day - 1` lowering with a no-op fails the main test (expects 2026-01-04). Failable.
- Rollup spec (ProductEventRollupServiceSpec): runs the real V114 SQL; 400-day one-tick rollup, WAU in/out-of-window, purge exemption, re-roll with preset mark, and the accepted-limitation documentation test all passed in the full run. (Not mutated separately.)
Code quality: migration is small, commented, additive; no dead code. CONTRIBUTING rules not implicated (SQL + test only).

### Phase 3: UI Review — N/A
Backend/SQL/test only; no UI-trigger paths changed.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- files-modified.md lists the spec at `.../infrastructure/persistence/V114BackfillSignupEventsSpec.scala` (correct); no action needed. The accepted limitation (re-applying V114 after old rows were purged defeats the partly-purged guard) is documented in SQL header and tested; fine for a run-once Flyway migration.

## Skeptic Report — final gate (round 1, skeptic-final-1.md)
Reviewed head_sha: 2561ccdb037f7e5912fd174e51cbca0fd09f67b0

### What I verified (with evidence)
- Diff vs live base 979095a9: V114 SQL, V114BackfillSignupEventsSpec, ProductEventRollupServiceSpec additions, openspec artifacts. Backend-only. V114 is the only migration above V113 on origin/main (no number collision).
- Re-ran `sbt testOnly V114BackfillSignupEventsSpec ProductEventRollupServiceSpec`: 10 tests, 0 failed.
- RLS hazard: spec runs Flyway as a NOSUPERUSER NOBYPASSRLS schema-owner role. Red-first naive INSERT...SELECT recorded: SQLSTATE 42704 "unrecognized configuration parameter app.current_user_id". My own mutation (deleted the set_config line from V114, reran spec): the real Flyway migration fails with 42704 and the main test fails; file restored via git checkout (worktree clean). So green genuinely depends on the per-user context, with rows actually inserted (A, B, D new; C pre-existing untouched).
- Idempotency: ON CONFLICT on uq_product_events_once_per_user; re-run body asserts 5 rows unchanged, existing row's properties/occurred_at untouched; no leak of app.current_user_id (set_config is_local) asserted on same connection after commit.
- No first_dashboard_rendered backfill: asserted 0 rows; SQL never inserts it.
- rolled_through reset: lowered to earliest-inserted-day - 1 only when rows inserted and mark >= that day; NULL stays NULL; unchanged when mark precedes all signups; empty users table no-op. Rollup spec covers NULL (400-day one tick), preset mark (re-roll restores mark), WAU in/out of window, purge exempting signup_completed, and a test that documents the partly-purged limitation.
- Evaluator's full-suite run (5239 tests, 0 failed) is a claim; I re-ran only the affected specs. No known flake (HEL-1228/1225/1215) occurred in my runs.
- ACs: backfill with created_at (spec); re-run no-op (spec); no duplicates/new signups unaffected (ON CONFLICT, concurrent row wins); non-superuser red-first with rows (spec). "Prod shows signups back to earliest user" is met in rollup data, but see notes.

### Verdict: CONFIRM

### Non-blocking notes (must appear honestly in the PR body; no PR text exists in the repo to verify)
- AdminUsageService.MaxDays = 90: /admin/usage only displays a 90-day window, so history older than 90 days is rolled up but not visible; the AC "back to earliest real user" is only visibly met within 90 days. Do not claim otherwise.
- Transient window: after V114 lowers rolled_through, /admin/usage's window ends earlier until the next tick (up to one tick interval).
- Historical DAU/WAU is signup-only; WAU is NULL for days outside retention.
- Re-applying the V114 body to a DB with purged history would corrupt re-rolled old days (accepted, Flyway runs once; tested/documented).
- Measured one-tick time over ~400 days is printed by the spec via info(); not separately cited here.

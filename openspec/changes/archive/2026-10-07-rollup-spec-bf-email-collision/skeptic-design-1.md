## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 0d28f43f036f0bfed63216c406572dca83a3dece (change dir untracked). No sbt run: everything below comes from reading the source.

### What I verified (with evidence)

- **The diagnosis holds. I checked it against the source myself.**
  - `ProductEventRollupServiceSpec.scala:85` is `countEvents("signup_completed") shouldBe 400 + otherUsers`. It runs before any tick. All timestamps are literals, and the Clock is pinned at :18.
  - `:69-71` inserts 400 users as `'bf' || g || '@t.local'`. `:73` cleans up with `LIKE 'bf%@t.local'`. `:76` sets `otherUsers` from `NOT LIKE 'bf%@t.local'`.
  - `ProductTelemetryDbHarness.scala:35-36,84-85` creates userA/userB with `UUID.randomUUID()` and email `<uuid>@t.local`.
  - `V10__owner_id.sql:2-3` seeds `system@helio.internal`.
  - V114 inserts one `signup_completed` per row in `users`. So actual = 400 + 3 = 403. If one harness UUID starts with `bf`, otherUsers = 2 and the expected value is 402. The CI log shows exactly this at line 11887 (`403 was not equal to 402 (ProductEventRollupServiceSpec.scala:85)`, under `V114 backfilled history` at :11864, 07:48 UTC).
  - The clock diagnosis is refuted, as the premise evidence says.
- **The `.invalid` domain is safe.**
  - `V6__users.sql:3` has only `email TEXT UNIQUE NOT NULL`. There is no format CHECK, so `bfN@backfill.invalid` inserts fine.
  - `product_events.user_id` is `ON DELETE CASCADE` (`V113:22`), so deleting the decoy by id also cleans its signup row.
- **The decoy does not disturb the sibling tests.**
  - It is inserted before the `created_at` UPDATE, so its day becomes 2026-09-23. That is g=10 of the bf series, so `COUNT(DISTINCT day) = 400` (:96, :117) is unchanged.
  - The earliest backfilled day is unchanged, so `minusDays(401)` at :113 holds.
  - `SUM(event_count)` at :97 uses the same `otherUsers`, so it stays consistent.
- **The spec has 7 tests** (:25, :32, :41, :48, :83, :109, :121). This matches C3.
- **Scope:** test-only and V114 untouched, so `skip_specs` is appropriate. No assertion is loosened.

### Verdict: REFUTE

### Change Requests

1. **Task 3.3's mutation contradicts design Decision 2 and does not test the guard.**
   - Decision 2 says that reverting Decision 1 makes :85 fail 404 vs 403. That is correct for a *full* revert: fixture email back to `'bf'||g||'@t.local'`, and both selectors back to `bf%@t.local`. The decoy then gets excluded, so otherUsers = 3 and actual = 404.
   - Task 3.3 instead reverts *only* the `otherUsers` selector and keeps the fixture on `@backfill.invalid`. Then `NOT LIKE 'bf%@t.local'` counts all 400 backfill users, so otherUsers = 403 and the failure is 404 vs 803.
   - That mutation fails whether or not the decoy exists, so it proves nothing about the decoy. That is the "evidence-shaped non-evidence" trap.
   - Revise 3.3 to the full revert. Name the exact expected failure (`404 was not equal to 403` at :85) in the task text. Also state that the run must fail with that message, not merely fail.
2. **AC3 ("The cleanup no longer deletes harness users") has no acceptance signal in tasks.md.**
   - No task checks that userA/userB survive `withHistoricalUsers`' `finally`.
   - Add one of:
     - a small permanent assertion, e.g. after a `withHistoricalUsers` block, `SELECT COUNT(*) FROM users WHERE id IN (userA, userB)` = 2;
     - or an explicit forced-`bf` run step that checks this and is saved to the logs.
   - Either must be shown to fail on the unmodified tree with the forced `bf` UUID, i.e. red first.

### Non-blocking notes

- In 1.1/3.1, the forced userA UUID must be a different literal from the decoy's fixed UUID. If they are the same, the decoy INSERT hits a PK/email unique violation. State both literals in the task.
- Expected arithmetic after the fix, for the executor's logs: the non-backfill users are system, userA, userB and the decoy, so the count is 4. That gives 404 == 404 both with and without the forced-`bf` userA, because after the fix the forced userA is counted. Before the fix, the forced run is 403 vs 402.

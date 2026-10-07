## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: e7e0dba9a4e3ad0d83eb5bb0c3e54168edfb1ba7. Base resolved live: 0d28f43f036f0bfed63216c406572dca83a3dece.
Diff: one Scala test file (`backend/src/test/scala/com/helio/services/telemetry/ProductEventRollupServiceSpec.scala`) plus OpenSpec change artifacts. No production code, migration, schema or frontend change.

### Phase 1: Spec Review — PASS
- AC1 (red before, green after with a forced `bf` UUID): the executor's `red-forced-bf.log` shows `403 was not equal to 402 (ProductEventRollupServiceSpec.scala:85)` with 6/1 tests, and `green-forced-bf.log` shows 7/0. These are the executor's transcripts. I did not re-run the forced-UUID red myself, because that needs a code edit and this role is read-only. The mechanism checks out by reading the SQL: under the full-revert mutation the decoy `bf222222-…@t.local` matches `bf%@t.local`, so `otherUsers` leaves it out (expected 403) while `countEvents` counts its V114 signup row (actual 404). `mutation-full-revert.log` shows exactly `404 was not equal to 403` at the current line 99, which is the `countEvents("signup_completed") shouldBe 400 + otherUsers` line (it moved from :85 because of the inserted lines). The survivor guard also fails (`2 was not equal to 3` at the current :85) in the other two V114 tests.
- AC2 (no tolerance loosened): both `400 + otherUsers` assertions are still exact equality, and no expected literal changed.
- AC3 (cleanup no longer deletes harness users): the cleanup now selects only `'%@backfill.invalid'`. A permanent survivor check (userA, userB and decoy, count 3) runs after every successful body. `red-survivor.log` shows that check failing on the old selector.
- Tasks 1.1–3.3 are all marked done and match the diff. `grep bf%@t.local` on the spec returns zero hits. `@backfill.invalid` appears nowhere else in `backend/src`.
- Scope: only the one spec file. `ProductTelemetryDbHarness.scala` (`backend/src/test/scala/com/helio/testsupport/`) is byte-identical to base, both in HEAD (`git diff --quiet`) and in the working tree (`cmp`). The working tree is clean.
- CONSTRAINTS C1–C3 are honored. The red transcript exists, the equality is exact, and every saved log shows a `Tests:` line (C3: 7 tests ran).

### Phase 2: Code Review — PASS
- My own fresh gate run: `cd backend && nice -n 19 sbt "testOnly com.helio.services.telemetry.ProductEventRollupServiceSpec"` exited 0 with `Tests: succeeded 7, failed 0`, and all 7 test names were listed. The run did not hit the sbt cache no-op. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1360/evidence/openspec/changes/rollup-spec-bf-email-collision/eval-1-spec-run.log`.
- `sbt testFull` was not run. Per the orchestrator's binding brief, I scoped it to the changed spec. The change touches only `private` members of one test class, and sbt compiled the whole Test configuration as part of `testOnly`, so no other suite can be affected.
- `node scripts/check-scala-quality.mjs` is clean. It reports only pre-existing soft warnings, none for this file.
- Code quality: no FQNs, no magic values without explanation (the decoy id is named and documented), and the comments explain the intent. The nested try/finally is correct. The backfill cleanup always runs. The survivor check runs only when the body succeeded, so it does not mask the body's real failure. Decoy deletion is in the outermost finally.

### Phase 3: UI Review — N/A
No trigger paths changed (no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`).

### Overall: PASS

### Non-blocking Suggestions
- `ProductEventRollupServiceSpec.scala:71`: the decoy INSERT sits before the outer `try`. If the following `UPDATE` or the 400-row INSERT threw, the decoy would leak, and the next `withHistoricalUsers` in the same suite would fail with a duplicate key. Moving the decoy insert inside the outer `try` would close this. It is cosmetic, because a failure there already fails the suite.
- `tasks.md` 3.3 says the mutation must fail "at :85". After the edit, that assertion is at line 99. The log is correct; only the task text has a stale line number.

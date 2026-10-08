## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 802aac1944c9ac33f98bab8b6d38a9eb0ed11cd4. Diff base (resolved live): c26c3056785e7a5a1d7a33508a039aa66b24a5a1.
Diff: one test file changed (`backend/src/test/scala/com/helio/services/telemetry/ProductEventRollupServiceSpec.scala`), plus OpenSpec change artifacts.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (counts scoped to the fixture's own users): met. `withHistoricalUsers` reads the roster once, right after the pinning UPDATE (`ProductEventRollupServiceSpec.scala:75`), and passes it to the body as an immutable `Set[String]`. Nothing re-queries it at assertion time. `fixtureSignups` (`:101-106`) counts by exact roster id plus the reserved `@backfill.invalid` domain. Both are allowed by the AC. The SUM expectation is `400L + roster.size` (`:128`). No whole-table `users` count is left in any expected value: `otherUsers` is gone, and a grep confirms it.
- AC2 (no wall-clock dependence): met. The late-user guard (`:79`, literal 2026-10-05) is the hazard with a fixed date, so it runs every time. I confirmed with an independent probe (below).
- AC3 (red first, mutation-failable guard): met and independently reproduced (below).
- AC4 (no tolerance loosened, test-only): met. Every assertion is still an exact `shouldBe`. The diff touches no production code, harness, migration or V114 file.
- tasks.md: every item is ticked and matches the diff. workflow-state.md has `CONSTRAINTS: []`, so there is nothing to violate.

### Phase 2: Code Review — FAIL
Gates (my own fresh runs; I did not rely on the executor's logs):
- `cd backend && nice -n 19 sbt testFull` in WORKTREE_PATH: 6124 tests run, 6124 succeeded, 0 failed, 4 canceled, 440 suites, 0 aborted. All 7 `ProductEventRollupServiceSpec` tests are present in the output.
- `node scripts/check-scala-quality.mjs`: "clean". It is blind to the violation below because it blanks string literals before matching, and the FQN sits inside an `s"..."` interpolation.

Independent re-verification of the executor's evidence. I ran these in a scratch copy of the backend under the session scratchpad (removed afterwards), not in the delivery worktree, using `sbt testOnly ...ProductEventRollupServiceSpec`. Each run reported "Total number of tests run: 7".
- Red: the unmodified base spec (c26c30567) plus `(1 to 3).foreach(_ => newUser())` on the first line of the "roll up in ONE tick" body gave `404 was not equal to 407 (ProductEventRollupServiceSpec.scala:112)`. Line 112 is the base file's SUM assertion (base line 111, shifted by the one-line probe). This matches the executor's `red-wallclock.log`, so the red log does come from an otherwise-unmodified spec.
- Same probe on HEAD: 7/7 green.
- Mutation (Decision 2 reverted: `otherUsers` def restored, `fixtureSignups(roster)`/`roster.size` replaced with whole-table `countEvents`/`otherUsers`, late user kept): `404 was not equal to 405 (ProductEventRollupServiceSpec.scala:129)`. In the mutated file, line 129 is exactly `SELECT SUM(event_count) ... shouldBe (400L + otherUsers)`. The restored `otherUsers` def adds one line ahead of it, moving the committed `:128` to `:129`. This matches the executor's claim. The raw-count assertions at `:116`/`:137` stay green under the mutation (405 = 405), as the design predicts. Only the rollup SUM catches it.

Issues:
1. [mechanical] CONTRIBUTING.md "Imports & Qualifiers": "Always import at the top of the file; never inline a fully-qualified name when an `import` would do." It names `java.util.UUID.randomUUID()` as an example. Violation: `ProductEventRollupServiceSpec.scala:102`, `s"'${java.util.UUID.fromString(id)}'"`. This is the only inline `java.util.UUID` in `backend/src/test/scala` outside an import or comment. It passes `check:scala-quality` only because the checker cannot see inside string interpolations, and CONTRIBUTING.md:236 says the checker enforces the rule, not that it defines it.

Everything else in the diff is sound:
- The `#$ids` splice is safe because every element is round-tripped through `UUID.fromString`.
- The roster always contains at least 3 ids (asserted at `:76`), so `IN ()` cannot happen.
- The late user is deleted by exact id in the outer `finally` (`:93`), and its `product_events` rows are cleared by the harness's `beforeEach`.
- The other two V114 tests stay correct with the late user present: 2026-10-05 is never rolled by a 2026-10-03 tick, and the earliest backfilled day still sets V114's lowered mark.

### Phase 3: UI Review — N/A
No UI-affecting files changed (only a backend test file and OpenSpec change artifacts).

### Overall: FAIL

### Change Requests
1. `backend/src/test/scala/com/helio/services/telemetry/ProductEventRollupServiceSpec.scala:102`: replace the inline `java.util.UUID.fromString(id)` with `UUID.fromString(id)` and add `import java.util.UUID` to the top-of-file imports (next to `import java.time.{Instant, LocalDate}` at `:9`). No other change is needed. Re-run `sbt "testOnly com.helio.services.telemetry.ProductEventRollupServiceSpec"` and confirm all 7 tests ran.

### Non-blocking Suggestions
- `fixtureSignups` could avoid the raw `#$` splice by binding the roster as one array parameter, e.g. `user_id = ANY(${roster.mkString("{", ",", "}")}::uuid[])`. It is safe today, but a bound parameter drops the need for the UUID round-trip comment.
- The late-user signup check (`SELECT COUNT(*) ... user_id = ${LateId}::uuid ... shouldBe 1`) appears twice (`:116`, `:137`). A small `lateSignups` helper next to `fixtureSignups` would remove the duplication.
- Worth a separate ticket: `scripts/check-scala-quality.mjs` blanks string literals before matching FQNs, so any FQN inside `s"${...}"` interpolation slips through. That is how this violation passed the pre-commit hook.

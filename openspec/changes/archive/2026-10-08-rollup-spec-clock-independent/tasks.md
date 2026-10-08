## Standing Constraints

- [C1] Red-first: reproduce the wall-clock failure (three `newUser()` rows at the top of the "roll up in ONE tick" body, unmodified spec otherwise) BEFORE editing the spec; keep the full transcript in the change directory.
- [C2] No assertion tolerance loosened; every count assertion stays an exact equality.
- [C3] Run the spec as `cd backend && nice -n 19 sbt "testOnly com.helio.services.telemetry.ProductEventRollupServiceSpec"` (Bash timeout 600000) and confirm in every saved log that all 7 tests actually ran (sbt 2 cache no-op hazard, MISTAKES.md). Full suite only via `sbt testFull`, never bare `sbt test`. Never bypass hooks.
- [C4] Test-file-only change: no production code, harness, migration or V114 edit.

### Tests

## 1. Reproduce (red)

- [x] 1.1 On the unmodified spec, add three `newUser()` calls at the top of the "roll up in ONE tick" body (uncommitted); run; save `red-wallclock.log` showing `404 was not equal to 407` (SUM assertion). Revert.

## 2. Fix

- [x] 2.1 Capture the pin-time roster (exact ids, right after the pinning UPDATE) in `withHistoricalUsers`; assert it contains userA, userB, decoy (design Decision 1)
- [x] 2.2 Replace `otherUsers` with roster-scoped expectations: scoped raw signup counts and rollup SUM equal `400 + roster.size`; no whole-table count in any expected value (Decision 2)
- [x] 2.3 Add the late-user guard (fixed non-`bf` UUID, `@t.local`, literal created_at 2026-10-05T09:00:00Z, inserted after the pinning UPDATE AND after the 2.1 roster capture so it is in neither; exactly one signup row for its id; deleted by exact id in `finally`) and `eventCount(2026-10-05, "signup_completed") shouldBe None` (Decision 3); verify no `otherUsers` whole-table count remains

## 3. Verify

- [x] 3.1 Re-apply the 1.1 probe on the fixed spec; run green; save `green-wallclock-probe.log`; revert the probe
- [x] 3.2 Final spec (no probe) green; save `green-final.log`
- [x] 3.3 Mutation: revert Decision 2 only (whole-table `otherUsers` expectations), keep the late user; must fail at the rollup SUM assertion with exactly `404 was not equal to 405` (any other failure does not count); save `mutation-revert-scope.log`; restore
- [x] 3.4 Run once more under `TZ=Pacific/Kiritimati` (green); save `green-tz.log`

# HEL-1360: ProductEventRollupServiceSpec:85 flakes when a harness user UUID starts with "bf" (403 vs 402)

## Description

`ProductEventRollupServiceSpec.scala:85` sometimes fails with `403 was not equal to 402`. It has been seen more than once, most recently in HEL-1339's report (CI run 37586488590 attempt 4, backend (3)).

### Original diagnosis: refuted

The ticket first said this was a time-of-day WAU flake: fixture timestamps relative to the wall clock, fixed by pinning the clock the rollup reads. That diagnosis is refuted (premise validation, 2026-10-07; owner chose `proceed-with-restated-scope`):

- Line 85 is `countEvents("signup_completed") shouldBe 400 + otherUsers`. It is a signup-row count, not WAU, and it is asserted before any rollup tick.
- Every timestamp in that test is a fixed literal. The service Clock is already pinned. Neither sighting was near a UTC boundary (07:48 and 03:10 UTC).

### Actual cause

- actual = 403, expected = 400 + `otherUsers` = 402, so `otherUsers` was 2. A passing run has 3 non-backfill users: V10's system user plus harness userA and userB.
- The harness emails are `<random UUID>@t.local` (`ProductTelemetryDbHarness.scala:84-85`).
- `otherUsers` filters on `email NOT LIKE 'bf%@t.local'` (spec :76). When userA's or userB's UUID starts with `bf` (about 0.78% of runs), that user is miscounted as a backfill user.
- The `withHistoricalUsers` cleanup (`DELETE ... LIKE 'bf%@t.local'`, spec :73) also deletes that harness user.

## Fix

Give the backfill users an email pattern that no harness or random-UUID email can match, and use it in both the `otherUsers` filter and the cleanup DELETE. Do not widen or loosen any expected value.

## Acceptance Criteria

- A run with a harness user's UUID forced to start with `bf` fails with 403 vs 402 before the fix and passes after it.
- No assertion tolerance is loosened.
- The cleanup no longer deletes harness users.

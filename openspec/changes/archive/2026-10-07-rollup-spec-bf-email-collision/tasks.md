## Standing Constraints

- [C1] Red-first: reproduce `403 was not equal to 402` at ProductEventRollupServiceSpec.scala:85 with a forced `bf`-prefixed harness UUID on the unmodified tree BEFORE editing the spec; keep the full transcript in the change directory.
- [C2] No assertion tolerance loosened; `countEvents(...) shouldBe 400 + otherUsers` stays exact equality.
- [C3] Run the spec as `cd backend && nice -n 19 sbt "testOnly com.helio.services.telemetry.ProductEventRollupServiceSpec"` (Bash timeout 600000), and confirm in every saved log that the 7 tests actually ran (sbt 2 cache no-op hazard, MISTAKES.md). Never bypass hooks.

### Tests

## 1. Reproduce (red)

- [x] 1.1 Temporarily force harness userA's UUID to `bf111111-1111-4111-8111-111111111111` (uncommitted), run the spec on the otherwise-unmodified tree; save `red-forced-bf.log` showing `403 was not equal to 402` at :85
- [x] 1.2 Keeping the force, add ONLY the Decision 2a survivor check for userA/userB (no decoy, no selector change); run; save `red-survivor.log` showing the check fail in the later V114 tests because cleanup deleted userA

## 2. Fix

- [x] 2.1 Switch the backfill fixture email to `'bf' || g || '@backfill.invalid'` and the cleanup/`otherUsers` selectors to `'%@backfill.invalid'`; verify by grep that no `bf%@t.local` remains
- [x] 2.2 Add the decoy user `bf222222-2222-4222-8222-222222222222` / `<that uuid>@t.local` (distinct from the 1.1 literal) to `withHistoricalUsers`, deleted by exact id in its own `finally`; extend the survivor check to userA+userB+decoy = 3 (design 2a); verify the spec compiles

## 3. Verify

- [x] 3.1 With the forced UUID still in place, run the spec green (expect :85 at 404 == 404); save `green-forced-bf.log`
- [x] 3.2 Remove the forced UUID (harness file byte-identical to main), run the full spec green; save `green-final.log`
- [x] 3.3 Mutation: FULL revert of design Decision 1 (fixture email and both selectors back to `bf…@t.local`), keep decoy+guard; run; the log MUST show `404 was not equal to 403` at :85 (any other failure does not count); restore; save `mutation-full-revert.log`

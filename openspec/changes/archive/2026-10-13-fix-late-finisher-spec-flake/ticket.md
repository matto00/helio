# HEL-1544: LateFinisherRunSpec flaked once in CI: pipeline deleted before Output list read returned Right instead of 404

## Description

origin_kind: followup
origin_ticket: HEL-1522

Found while delivering HEL-1522. CI run 38401459066, job `backend (3)`, failed one test on PR matto00/helio#994. The
head was 630dc3056, which includes HEL-1518 (matto00/helio#993) from main:

`com.helio.services.pipelines.LateFinisherRunSpec`: "should answer 404, write nothing and publish no succeeded when
its pipeline was deleted before the Output list was read". It got `Right(RunResultResponse(...3 rows...))` and expected
`Left(NotFound("Pipeline not found: ..."))` (LateFinisherRunSpec.scala:209).

Evidence that this is a timing flake and not HEL-1522:

* The same head passed this spec 4 times out of 4 locally.
* Re-running the failed CI job passed.
* HEL-1522 does not touch the run executor, the reaper or the Output-list read.

What it suggests: the `beforeOutputList` hook's `deletePipeline(fx)` may not be sequenced before the Output read under
CI's group concurrency (`HEL924_TEST_GROUP_CONCURRENCY=2`). It may also point at a real narrow window in the HEL-1518
D7 path. Investigate which before calling it test-only.

## Duplicate report (HEL-1558, closed as duplicate of this ticket)

Observed again on PR matto00/helio#1002 (HEL-1440), CI run 38464296036, job backend (3) (job 115527123328), head
ce8bb7615. Same test, same `Right(RunResultResponse(... 3 rows ...))` vs `Left(NotFound(...))`. The same log has
interleaved WARNs from the neighbouring reap test ("finished after it was reaped as abandoned; discarding its outcome")
for a different run id, suggesting hook/state leakage between tests or an ordering race under CI load. Passed 3/3
locally on the same head; a rerun of the failed job passed. Needs a root cause (systematic-debugging), not a retry.

## Acceptance Criteria

1. The flake's root cause is identified and probe-confirmed: the failing outcome (`Right` where `Left(NotFound)` is
   expected) is reproduced deterministically by forcing the suspected interleaving, with the probe and its output
   recorded as evidence.
2. The root cause is classified as test-only (spec sequencing) or production (a real defect in the HEL-1518 D7 path),
   with the reasoning stated against HEL-1518 design.md D7 ("first terminal write wins").
3. The fix removes the cause; no retry, sleep, or widened timing is used as the fix.
4. Red-then-green: the forced interleaving fails the unfixed test and passes the fixed one; a mutation that disables
   the D7 guard (`failIfLostTerminalWrite` -> no-op) still turns the fixed test red, proving it still guards D7.
5. Every other test in `LateFinisherRunSpec` with the same unsequenced pattern is audited and fixed the same way, or
   shown not to be exposed.
6. The spec passes repeatedly under CI-like conditions (`HEL924_TEST_GROUP_CONCURRENCY=2`, CPU load), with exact runs
   reported.

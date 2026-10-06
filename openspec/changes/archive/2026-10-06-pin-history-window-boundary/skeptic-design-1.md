## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Query is `<=` today: OutputHistoryRepository.scala:89-92 (`r.capturedAt <= at`, order capturedAt desc, id desc, take 1). Service passes `head.capturedAt.minus(w)` (OutputHistoryService.resolveBaseline, ~line 118). No product bug expected; premise holds.
- Microsecond approach is sound: column is Slick `Instant` (Slick 3.5.2) over timestamptz; the filter parameter and stored value use the same mapping, micros survive. Wire `capturedAt` is `Instant.toString` (OutputHistoryProtocol.scala:95/98), which prints 6 fractional digits, so `baseline == boundary.toString` is a valid exact check. The planned `getNano % 1000 == 0` precondition plus read-back round-trip assertions make any rounding fail loudly rather than silently move the boundary.
- Mutation `<=` -> `<`: nearestAtOrBefore(b) returns the b-1µs decoy (non-null, wrong). Repo test (expects b) and route test (expects baseline b, value 20, delta 30, pct 150) both go red for the right reason. The pre-existing whole-second exactly-at repo test will also go red; the red transcript should note that so it is not read as an unexpected extra failure.
- C7 preserved: route Tb = T-1d+123.456ms is ~4d5h before now. A now-relative target (now-7d) lies after b+1µs, so it would select the b+1µs point (40) and delta 10 != 30: still killable. Earliest-relative variant picks neither b. Boundary is relative to the stored newest point, so it is deterministic.
- Placement: OutputHistoryRoutesSpec already extends HelioRouteTest and uses OutputHistoryApiHarness (addPoint/seedMetricOutput exist); OutputHistoryRepositorySpec uses EmbeddedPostgres. No new spec files needed.
- Spec delta: diffed against openspec/specs/output-history-api/spec.md "Comparison resolution": requirement text identical; the only difference is the added scenario "A point exactly at the window boundary is the baseline" (plus a trailing blank line). Faithful MODIFIED copy.
- ACs: repo-level test (task 1.1), route-level test (2.1), red under mutation (3.1/3.2), microsecond exactness stated (design decision 1). All covered; no scope drift; no placeholders or contradictions found.

### Verdict: CONFIRM

### Non-blocking notes
- State in mutation-red.txt that the pre-existing `exactly-at` repo test also fails under the mutation, and cite the two new tests by name.
- Task 2.1 should assert both the decoy exclusion and (cheaply) that the b+1µs point (40) is not chosen, which the plan already includes via delta 30.
- Tasks.md 4.1 says "sbt testFull (2 workers)"; ensure it carries `HEL924_TEST_GROUP_CONCURRENCY=2` as in C3.

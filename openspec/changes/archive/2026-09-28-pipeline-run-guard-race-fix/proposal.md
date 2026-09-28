## Why

`PipelineRunGuardIntegrationSpec`'s "rejects more than maxConcurrent REAL concurrent
submissions" test failed in CI (4 admitted vs `maxConcurrent = 3`) despite the
`GatedExecutionBackend` fix HEL-505's review already shipped for this exact test. Either
the test's own coordination premise is still wrong, or the production concurrency guard
(`PipelineRunRepository.insertRunIfUnderConcurrencyCap`, shipped in v0.8.4, load-bearing
for HEL-1097's auto-run-burst bound) really over-admits under contention. Both are live
until probed; this proposal is deliberately hypothesis-neutral until that probe runs.

## What Changes

- Add lock-acquire/release and admission-decision instrumentation, run a forced small-pool
  (3-4 workers, `nice -n 19`) repeated-loop repro to determine which of the two hypotheses
  holds (per `.concertino/laws/systematic-debugging`) — no code change ships before this.
- Depending on the confirmed root cause:
  - **Test-premise defect**: fix `awaitQueuedCount`'s coordination so it cannot return
    before every submission in the burst has settled its own admission decision, and add
    a separate, deterministic interleaving test that proves the guard's atomicity without
    relying on timing/polling.
  - **Guard defect**: fix `insertRunIfUnderConcurrencyCap`'s locking/transaction scope so
    admission and count are genuinely serialized against every concurrent submitter, with
    a deterministic interleaving test that is red against the current guard and green
    after the fix.
- Either way: no loosened assertion, no retry, no added sleep.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — this fixes either a test coordination defect or a guard implementation defect
against its EXISTING, unchanged concurrency-cap contract; no spec-level requirement
changes either way)

## Impact

`backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala`
(test-only H1 coordination fix), and, conditionally, `backend/src/main/scala/com/helio/
infrastructure/persistence/pipelines/PipelineRunRepository.scala` (only if H2 confirmed).
`backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/
PipelineRunRepositorySpec.scala` (lines 639-660) is read/cited, not modified, as the
existing independent proof of guard atomicity (design-gate round 1 finding) — a new test is
added there only if the probe surfaces a gap it doesn't already cover. No API/schema change.
No migration expected (V110 remains latest; V111 available if a root cause surprises us).

## Non-goals

- Not re-litigating HEL-505's design (rate limit, dry-run exclusion, trigger-source
  uniformity) — only the concurrency-cap admission race.
- Not adding retries/backoff to the guard or the test.

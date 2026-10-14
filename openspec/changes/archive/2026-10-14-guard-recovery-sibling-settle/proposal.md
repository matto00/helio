## Why

HEL-1564's D2 makes `PipelineRunDeletedRecovery.recover` wait for the success chain's eager sibling writes
(`settle(siblings)`) before it answers, so `succeeded` is still published only after the chain's writes settled
(HEL-1366). No test turns red when that wait is removed: every late-finisher test lets the siblings finish before the
chain fails or answers. The behaviour is unguarded.

## What Changes

- Add a test seam to `LateFinisherSpecBase` that holds one eager sibling write (the binary-reference upsert) open on a
  test-owned promise and records when it settled, plus a signal for when the chain's node write failed, following
  HEL-1565's capture-at-call-start convention.
- Add one test on the "write won, pipeline deleted" recovery path: the answer must not arrive while the sibling is
  held, and once released the answer is success, after the sibling settled, with exactly one `succeeded` event.
- Prove it red by temporarily removing the wait in production code (never committed); record red and green output.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change (`skip_specs: true`); no spec-level behavior changes.

## Non-goals

- Any production (`backend/src/main`) change. A production defect found on the way is escalated, not fixed.
- Sleeps or retries to force orderings.
- Covering the lost-write (D1b) and non-recovering paths' settle separately: they share the same single `settle` call,
  so the one mutation this ticket asks for is caught by the won-path test.
- Changing any existing late-finisher test's assertions.

## Impact

- `backend/src/test/scala/com/helio/services/pipelines/LateFinisherSpecBase.scala` (new seam state, reset).
- `backend/src/test/scala/com/helio/services/pipelines/LateFinisherDeleteAfterWonSpec.scala` (one new test), or a
  sibling spec sharing the base if the file budget requires it.
- Evidence in this change directory. No API, schema, migration, or frontend change.

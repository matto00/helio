## Why

HEL-1341 (merged as 6c7cdcde) left three hygiene leftovers in backend test code and its archived audit: a test helper
named as if it asserts, a test description that no longer describes what it checks, and two timing sites missing from
the wall-clock inventory. Misleading names and an incomplete inventory make the next timing audit start from a false
picture.

## What Changes

- Rename `AcceptRecordingListener.assertNothingAcceptedBeforeSentinel()` to a name that says what it does (returns the
  accepted ports through a sentinel barrier); update its four callers and scaladoc. Behaviour-preserving.
- Rename the real-clock test in `DatasetWriteAutoRunEndToEndSpec` so its description states its actual check (one run
  created via the real system clock within a bounded state wait; elapsed time only printed under `HELIO_MEASURE=1`).
- Add classification rows for `PipelineShapeServiceSpec` (`whenReady`) and `SparkJobSubmitterSpec:345` to the archived
  HEL-1341 inventory and correct its "only default-patience `eventually`" sentence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-code and documentation only; `skip_specs: true`.

## Non-goals

- Spin-wait without pause in the HEL-1341 waits (HEL-1355).
- OutputRoutesSpec:780 negative check (HEL-1356, merged).
- Changing any production code, any assertion, or any wait bound.

## Impact

- `backend/src/test/scala/com/helio/testsupport/AcceptRecordingListener.scala` and its four caller specs.
- `backend/src/test/scala/com/helio/services/pipelines/DatasetWriteAutoRunEndToEndSpec.scala` (test name only).
- `openspec/changes/archive/2026-10-06-audit-wall-clock-spec-races/design.md` (inventory rows + one sentence).

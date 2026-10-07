# HEL-1357: Rename misleading HEL-1341 spec helpers and finish the wall-clock inventory

## Description

Leftovers from HEL-1341, found after it merged as 6c7cdcde:

1. `assertNothingAcceptedBeforeSentinel()` asserts nothing, so its name is misleading. Either rename it or make it actually assert.
2. The real-clock test in `DatasetWriteAutoRunEndToEndSpec` still says it "reports the observed elapsed time". It no longer does that; update the description to match what it checks.
3. Two sites are missing from the inventory in `openspec/changes/archive/2026-10-06-audit-wall-clock-spec-races/design.md`: `PipelineShapeServiceSpec` (`whenReady`) and `SparkJobSubmitterSpec:345`. Classify both. They are believed to be harmless, so verify that.

The spin-without-pause issue in the new waits is covered by HEL-1355. The OutputRoutesSpec:780 negative check is covered by HEL-1356.

## Acceptance Criteria

- The helper's name no longer claims it asserts (or it genuinely asserts, proven by a red run); the change is behaviour-preserving for every caller.
- The DatasetWriteAutoRunEndToEndSpec real-clock test's description matches what it checks.
- Both missing sites are classified in the HEL-1341 inventory, with the "harmless" belief verified against the code.

## Driver notes (premise validation, orchestrator)

- Item 2 is partly stale: the test still prints elapsed time, but only when `HELIO_MEASURE=1`; it asserts exactly one run is created within a 10s state wait via the real SystemClock.
- `PipelineShapeService.expand` returns `Future.successful`, so `whenReady` never waits. `SparkJobSubmitterSpec:345` is `eventually(30s timeout, 50ms interval)` inside `awaitRunPersisted`, a bounded state wait.
- design.md line 38 claims the only `eventually` on the 150 ms default patience is row 8a; `whenReady` shares that default, so that sentence must be corrected too.

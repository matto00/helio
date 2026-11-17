## Why

The HEL-1277 history-scrubber e2e (`e2e/hel1277-output-history-scrubber.spec.ts:57`) flaked in CI for PR #1129: the
"Recorded runs" slider showed value 3 (four points) where the spec expects 2 (three points). A flaky gate trains
people to rerun red CI, which hides real failures.

Planning-time evidence points at a test race, not the 00:00 UTC theory: the spec rewrites its static source with
`PUT /api/data-sources/:id/rows` between manual runs, and `DataSourceService.replaceRows` arms a debounced dataset-write
auto-run (`AutoRunTriggerService`, fire at write + 5 s) that the 30 s scheduler tick later fires as a fourth REAL run.
The spec's API check (exactly 3 points) runs immediately; the UI read happens seconds later, after which the auto-run can
land. `e2e/hel1392-remount-staleness.spec.ts:207` already documents this auto-run. The living spec
`openspec/specs/dataset-write-auto-run/spec.md:10-16` requires that a successful dataset write SHALL schedule a debounced
auto-run of every eligible downstream pipeline, and nothing lets a manual run cancel it, so that extra point is
spec-required behavior, not a defect. (The rearm design's line 124 covers only the in-flight-run unclaim case, not this
one.) This is a hypothesis until the executor's probe confirms it.

## What Changes

- Probe the cause first (CI artifact if available; a forced repro that waits out the debounce + tick; read the
  thinning code to rule the UTC-boundary theory in or out).
- If the auto-run race is confirmed: make the spec deterministic by cancelling the pending auto-run the spec's own
  source writes arm, by exact pipeline id, asserting the cancellation actually happened (no sleeps, retries or longer
  timeouts). Apply the same treatment to any other test in the file that writes rows.
- If the probe instead finds a real duplicate-point backend defect: fix it with a red-first unit test (escalate if
  that grows beyond the ticket).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only unless the probe finds a product defect (then this plan is revised and re-gated).

## Impact

`e2e/hel1277-output-history-scrubber.spec.ts`, `e2e/support/historySeed.ts` (or a sibling e2e support helper). No
backend, frontend, schema or migration change on the expected path.

## Non-goals

- Changing dataset-write auto-run semantics (spec-required today). Whether a manual run that already read a write
  should supersede its pending auto-run is a possible follow-up, not a decision made here.
- Fixing other flaky specs.

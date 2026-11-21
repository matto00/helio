## Why

The HEL-1683 e2e probe (`e2e/hel1683-regex-main-thread.spec.ts`) bounds the CONTROL edit's longest main-thread long task
at 100 ms. Almost every recorded run measures 0 ms, but one HEL-1697 CI run logged 74 ms and another 58 ms. On the
~1.4x slower CI hosts (HEL-1793) a 74 ms task is ~104 ms: a future flake that would read as a regex regression when it
is not. The bound is right; the control window measures work that is not the evaluator's.

## What Changes

- Attribute the control window's long task: what script/rendering/network-response handling it is made of (Long
  Animation Frame script attribution and/or a CPU-throttled local reproduction), recorded as evidence.
- Reshape the control edit (frame, window, or settle point) so the measured window contains the client evaluator's
  own work and not unrelated work (dev-build re-render on a late response, analyze round-trip, initial-load tail).
- Keep `LONG_TASK_BOUND_MS = 100`. Keep the probe and overrun assertions and the HEL-1697 long-cell test intact.
- Log enough per run (control longest task + attribution) that each CI run's value can be read with the leg's CPU
  model from the HEL-1789 `e2e-runner-shard-<n>` artifact.

## Capabilities

### New Capabilities

### Modified Capabilities

None: test-only change, no requirement changes (`skip_specs: true`).

## Impact

- `e2e/hel1683-regex-main-thread.spec.ts` only (plus test fixtures if needed). No app, backend or schema code.

## Non-goals

- Raising the 100 ms bound (escalate to the owner if that is the only fix).
- Changing the client evaluator, the decline rules or the server regex budget.
- Fixing other flaky specs (HEL-1813 etc.).

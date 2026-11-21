## Why

Two HEL-1573 motion e2e assertions read wall-clock or event-time state that a slow or loaded CI host perturbs, so each
fails intermittently on main and, with eight e2e legs (HEL-1793), turns main red. They should prove the motion
contract (token duration and easing, no entrance replay) without depending on how fast the host runs.

## What Changes

- `e2e/support/hel1573-motion-primitives.ts` (Full mode, segmented and rail indicator): replace the "a `transitionrun`
  record exists" dependency with a check that cannot miss under load -- wait for the indicator to be `ready` before the
  click, and prove the transition from the element's computed `transition-*` values plus one observed transform
  transition (event-level, recorded even if the transition already finished).
- `e2e/support/motionRecorder.ts`: if the probe confirms it, a `transitionrun` fallback that records from computed
  `transition-*` values when the transition is already gone (mirrors the existing `animationstart` fallback).
- `e2e/hel1573-motion-grid-chart.spec.ts` (chart test): replace the wall-clock `later` span bound (and the entrance
  span bound, if probing shows it is equally exposed) with what ECharts actually configured (animator durations /
  applied option), keeping any remaining wall-clock bound generous and justified.
- Root cause per spec recorded as evidence; red-first runs and mutation runs committed as `.txt`.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
None -- test-only change; no product behaviour changes (`skip_specs: true`).

## Impact

e2e test code only (`e2e/support/hel1573-motion-primitives.ts`, `e2e/support/motionRecorder.ts`,
`e2e/hel1573-motion-grid-chart.spec.ts`). No app, API, schema or migration change.

## Non-goals

- Changing motion tokens, `useIndicatorSlide`, `chartAppearance.ts` or any app behaviour (escalate if the root cause is
  in the app).
- Other flaky specs on the C11 list; sibling lanes' files (HEL-1796, HEL-1808).

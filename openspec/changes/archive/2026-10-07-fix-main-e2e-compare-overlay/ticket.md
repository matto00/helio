# HEL-1373: Main e2e red: hel1350 times out after HEL-1285 + HEL-1366; hel1351 fails after UTC midnight

## Description

Main CI e2e is red. b14e622ee (HEL-1366) was the last green main run. These runs failed:

* 96712881e (HEL-1285), run 37703155327;
* e4289e6c8 (HEL-1369), run 37703350572.

This blocks HEL-1370 (PR matto00/helio#833) and HEL-1361's measurement.

### Failure 1: hel1350 is deterministic on main

* `e2e/hel1350-chart-compare-picker.spec.ts:34`, light and dark, times out after 2.5 minutes. It is then reported as `apiRequestContext.delete: Target page, context or browser has been closed` at `:206`, which is the cleanup running after the timeout.
* Likely a semantic merge interaction. HEL-1285's PR #829 was green on all 4 e2e legs, but its head did not contain HEL-1366 (b14e622ee). HEL-1366 merged 23 minutes earlier and changed hel1350's login helper and the timing of the pipeline-run terminal SSE events (now published after persist). HEL-1285 also edited hel1350, re-adding the chart "Previous" option.
* Find the real cause from the trace; don't guess.

### Failure 2: hel1351 fails only after 00:00 UTC

* `e2e/hel1351-aggregated-chart-overlay.spec.ts:249`: `expect(hovered).toMatch(/\b(15|7)\b/)` against the tooltip text `"...sum(amount)15vs 7d11..."`. The values are correct; the text has no word boundary between "15" and "vs".
* It passed in every run that started before 2026-10-08T00:00Z and failed in every run after. Check whether the tooltip content depends on the date (the "vs 7d" baseline window, a date-label path) and fix the cause. A regex tweak is acceptable only if the tooltip content is correct and the date dependence is explained.

### Also seen

* `frontend/src/features/panels/ui/PanelCard.test.tsx`: the HEL-579 re-render count came out 3 where 2 was expected, once (HEL-1361 attempt 3). Check whether it relates to the above or to HEL-1215's known flake.

Evidence: HEL-1361's `profile.md` and `ci-logs/`; HEL-1370's log at `scratchpad/ci-e2e3-run1.log`.

## Acceptance Criteria

1. hel1350's failure is reproduced locally on main, and its root cause is identified from the Playwright trace and the backend log (not from merge-order inference) and stated with evidence.
2. hel1351's "only after 00:00 UTC" pattern is verified or refuted (e.g. faked clock on either side of midnight), and the date dependence (if any) is explained; the fix addresses the cause.
3. The fix does not weaken what either spec proves; any changed assertion is justified as genuinely wrong.
4. The PanelCard.test.tsx 3-vs-2 observation is classified (related to this, or HEL-1215's known flake) with evidence.
5. All 4 e2e legs green in CI on the PR, with the PR head containing current origin/main.

## 1. Probe (root cause, before any fix)

- [x] 1.1 Write a deterministic test that races `createDashboard` and `fetchDashboards` (both
      orderings) against `dashboardsSlice`, or an equivalent request-layer probe, and show it goes
      RED against today's code — this is the AC1 evidence, not an inference.
- [x] 1.2 If the probe instead points at a double dashboard-create request (two backend rows), pivot
      the probe to that mechanism and document why the reducer-race hypothesis was refuted.
- [x] 1.3 Determine and state explicitly: is this the same underlying defect as HEL-706, or distinct?

## 2. Fix

- [x] 2.1 De-duplicate `dashboardsSlice.items` by id at whichever boundary the probe implicates
      (e.g. `createDashboard.fulfilled`'s append becomes push-or-replace-by-id).
- [x] 2.2 Preserve existing ordering/selection semantics (`getMostRecentDashboardId`,
      `selectedDashboardId` assignment) for the non-race case.
- [x] 2.3 Check `panelsSlice`/data-sources slice/`pipelinesSlice` for the same append-shape risk;
      state findings explicitly (fix inline if small and same-shape, else flag for a follow-up
      ticket via triage rather than silently expanding scope).

## 3. Regression guard + verification

- [x] 3.1 Turn the probe from task 1 into a permanent regression test; confirm it goes RED when the
      fix from task 2 is reverted/mutated (state the exact mutation used).
- [x] 3.2 Run `e2e/focus-presence-guard.spec.ts` locally enough times (or under the same
      timing-skew technique as the probe) to gain confidence the flake is gone; do not loosen the
      `exact: true` / strict-mode locator.
- [x] 3.3 Check whether the duplicate is visible to a real user under a throttled connection (not
      just under test timing) and state the finding in the PR — this affects real-world severity.
- [x] 3.4 Run full frontend gates (lint, typecheck, jest, format) and confirm no regressions.

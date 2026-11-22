## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 69753d108ac59eb3d3fb43cdc3d514dd900ce73c. The diff base was resolved live with `resolve-review-base.sh` and is 07a1180016b8032c9c16f2514aa8a8c0319cb776.

### What I verified (with evidence)
- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/no-transient-dashboard-selection/HEL-1624`.
- **Diff read in full.** The production code change is three files:
  - `dashboardsSlice.ts`: the thunk computes `loadTarget` after the `await` and passes it with `fulfillWithValue(list, { loadTarget })`. The `fulfilled` reducer applies `meta.loadTarget` when the key is present, including an explicit null. When the key is absent it falls back to `getMostRecentDashboardId`.
  - `loadTarget.ts` is new and imports only `tabTypes`, so there is no import cycle with `hydrateTabs.ts`, which imports the slice.
  - `hydrateTabs.ts`: `planHydration` now takes its target from `resolveLoadTarget`. Its tabs and dirty branches are unchanged.
  - I traced all five precedence branches. With `autoSelectedId = target`, hydration's later `setSelectedDashboardId(plan.target)` writes the same value. In the no-saved-key branch the target is `autoSelectedId`, which is the landing default, so that is also the same value.
- **Refetch risk checked.** The only thunk dispatchers are `App.tsx:166` (mount) and `useResourceIndexing.ts:77`. The second fires only when the status is idle or failed. The target is applied only when the existing selection is not in the list, so a selection that already exists is never overridden.
- **AC1 (deep link never holds another dashboard; a test records every value)** is met by `loadSelection.test.ts`. It subscribes to the store, records every selection value through fetch, a simulated DashboardRoute effect and the full `hydrateTabs` run, and asserts that only null and the target appear.
- **Driver AC (red first, saved-active-tab case covered).**
  - Commit 3aeebc3fe adds the test and `red-jest-loadSelection.txt` before commit 7b93e4f1e, which has the implementation. The red file shows the landing default "A" recorded in the RED cases.
  - The saved-active-tab, surviving-none-active, stored-empty and grantee cases are present.
  - `mutation-reducer-ignores-loadTarget.txt` shows 5 failed and 2 passed, which is exactly the five RED cases.
- **Driver AC (grantee).** The jest grantee case is present. The e2e `hel1624-direct-load-selection.spec.ts` uses a real share (viewer role), and the grantee's own dashboard is created later, so it is their landing default. The spec's red-on-main signal is the persisted recents (`red-e2e-direct-load-selection.txt`: `not.toContain(own.id)` failed on main).
- **Driver AC (request log).** The e2e logs every request keyed on the landing dashboard and asserts the list is empty. It is honestly labelled as a GUARD, because the panel fetch is already gated on hydration on main. `mutation-e2e-panel-fetch-landing-default.txt` records a mutation that turns it red.
- **Driver AC (consumer audit).** `consumer-audit.md` has one row per non-test file. It covers the panel fetch, document title, recents, tabs hydration, the HEL-1783 warm cache and change dots, the HEL-1634 session reset and the HEL-1782 viewer shell, plus the D4 minimum set.
- **AC2 (no regression in HEL-1575).**
  - The one changed HEL-1575 assertion is `AppShell.tabsHydration.test.tsx:88`, which now expects "b" instead of "a". It is called out in a comment: it asserted the exact transient value this ticket removes. Per C4 this is a legitimate change.
  - I ran Playwright fresh, 2 workers, with `DEV_PORT=7056` against `helio_hel1624` and an empty key, on `e2e/hel1624` plus `e2e/hel1575-`: **29 passed, 1 skipped (the pre-existing switch-measurement skip)**, and the run cleaned up 30 throwaway users.
- **Jest, run fresh** with 3 workers on loadSelection, hydrateTabs, dashboardsSlice, tabsHydration, recentVisits, dashboardTabs and loadTarget: **14 suites, 165 tests passed**.
- **Static gates, run fresh:** frontend typecheck exit 0, lint exit 0.
- **Servers.** Started through `start-servers.sh`, `assert-phase.sh servers` returned PASS, and they were stopped through `stop-servers.sh` (`STOPPED ports=7056,9963`).
- **UI review.** Not applicable. No component, stylesheet or markup changed: only state logic changed. The only visible effect is that the transient wrong chip, title and recents entry no longer appear. The e2e covers the recents entry, so there is nothing to judge against DESIGN.md.

### Verdict: CONFIRM

### Non-blocking notes
- `evaluation-2.md` and `evaluation-3.md` are untracked in the worktree. Commit them with the change before archive.
- `dashboardsSlice.ts` is about 608 lines. Mention a split in the PR description, per CONTRIBUTING.md (carried from the evaluator).
- I did not re-run the red-on-main jest or e2e runs myself. The committed red files, the commit order and the mutation records are consistent with each other and with the code. Red on main also follows directly from the main reducer selecting `getMostRecentDashboardId` first.

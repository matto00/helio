## Standing Constraints

- [C1] Red first with mutation: every RED-labelled test is run and committed red (.txt) before implementation code; every GUARD names and runs the mutation that turns it red.
- [C2] Playwright 2 workers total, jest 3 workers; never two Playwright batches at once.
- [C3] Lane-private DB helio_hel1624 for start-servers.sh, Playwright, e2e cleanup and any DB-touching jest/hook run; backend started with ANTHROPIC_API_KEY empty.
- [C4] A test fixture or assertion changed to make tests pass is called out with its reason in the executor report, never changed silently.

## 1. Red first

- [x] 1.1 Write the store-level selection-recording jest test (D5) with all seven cases (five RED on main, two GUARDs); run the full spec file on unmodified code; commit the red run as `.txt` in the change dir before any implementation.
- [x] 1.2 Write the e2e spec (D5: grantee fixture, request log over the load, plus one signal proven RED on main); record its red run as `.txt` and commit it. If the request-log assertion is green on main, label it a GUARD and record the mutation run that turns it red. (Recorded: `mutation-e2e-panel-fetch-landing-default.txt`; removing the `hydrated` gate alone does not turn it red, see `mutation-e2e-gate-and-reducer.txt`.)

## 2. Implementation

- [x] 2.1 Create `frontend/src/features/dashboards/tabs/loadTarget.ts` (imports only `tabTypes.ts`) holding `deepLinkDashboardId`, `mostRecentlyViewed` and the target precedence; `planHydration` calls it; `hydrateTabs.ts` re-exports `deepLinkDashboardId` if needed; no import from `hydrateTabs.ts` into the slice (D2).
- [x] 2.2 `fetchDashboards` reads `auth.currentUser` and `window.location.pathname` after the request's `await`, computes the target, and returns `fulfillWithValue(list, { loadTarget })`; `fulfilled` applies `meta.loadTarget` when present and no valid selection exists, else falls back to `getMostRecentDashboardId` (D1, D1a, D3).

## 3. Verification

- [x] 3.1 Mutation: make the reducer ignore `meta.loadTarget` and confirm every RED case goes red; record the output.
- [x] 3.2 Write `consumer-audit.md` from `grep -rln selectedDashboardId frontend/src` (non-test), one before/after row per file, covering at least the D4 minimum set.
- [x] 3.3 Run the full affected jest spec files (new test, hydrateTabs, dashboardsSlice, recents listener), lint, typecheck, and the HEL-1575 tab e2e specs plus the new spec (Playwright 2 workers total). Evidence (cycle 2): lint=0, format:check=0, typecheck=0, root jest 73 suites/645 tests, frontend jest 918 suites/10588 tests, Playwright 2 workers `e2e/hel1575-` + `e2e/hel1624`: 29 passed, 1 skipped (pre-existing), exit 0.

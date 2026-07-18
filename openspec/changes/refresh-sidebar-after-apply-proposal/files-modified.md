# Files modified — HEL-290

- `frontend/src/features/dashboards/state/dashboardsSlice.ts` — new `applyProposal` async thunk (calls `applyDashboardProposal` aliased `*Request`, server-message passthrough in `rejectWithValue` mirroring `importDashboard`) + `applyProposal.fulfilled` reducer that pushes the created dashboard onto `items` and selects it (mirrors `duplicateDashboard.fulfilled`). This is the root-cause fix: the list is now updated in the same dispatch cycle instead of relying on the condition-blocked `fetchDashboards` refetch.
- `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx` — `handleAccept` now dispatches `applyProposal(edited).unwrap()` and navigates on success; removed the manual `fetchDashboards()` + `setSelectedDashboardId` calls and the now-unused `extractError` helper (error string now comes from the thunk's `rejectWithValue`). Kept local `applying`/`applyError` state and `navigate("/")`.
- `frontend/src/features/dashboards/state/dashboardsSlice.test.ts` — added `applyProposal.fulfilled` (appends + selects) and `applyProposal.rejected` (items/selection unchanged, carries server message) reducer tests, mirroring the duplicate/import coverage.

## Root cause (systematic-debugging Iron Law)

- **Root cause (state layer):** `ProposalReviewPage.handleAccept` re-dispatched `fetchDashboards()`, but that thunk carries `condition: status === "idle"`. Once the list has loaded (`status === "succeeded"`) the dispatch is silently condition-blocked, so `items` never gains the applied dashboard while `setSelectedDashboardId` pointed `selectedDashboardId` at an id absent from `items` — the sidebar renders the stale/empty list until a later idle-fetch.
- **Probe:** temporary Jest test (`hel290Probe.test.ts`, since removed) — seeded a real store to `status: "succeeded"`, spied on `dashboardService.fetchDashboards`, dispatched `setSelectedDashboardId("dashboard-new")` then `await dispatch(fetchDashboards())`.
- **Probe output:**
  - `PROBE fetchDashboards service call count: 0` (condition-blocked — service never called)
  - `PROBE items ids: [ 'dashboard-1' ]` (new dashboard never entered `items`)
  - `PROBE selectedDashboardId: dashboard-new`
  - `PROBE selected present in items? false` (selection dangles → stale sidebar)

  The probe confirmed the hypothesis predicts the symptom, so the fix proceeded.

## Repro-widening audit (task 3.1)

Re-verified the other dashboard-mutating flows in `dashboardsSlice.ts`:

- `createDashboard.fulfilled` — `items.push` + select ✓
- `duplicateDashboard.fulfilled` — `items.push` + select ✓
- `importDashboard.fulfilled` — `items.push` + select ✓
- `deleteDashboard.fulfilled` — `items.filter` + reselect most-recent ✓

All in-app flows mutate `items` in their fulfilled reducer. Apply-proposal was the sole flow bypassing the slice — no other same-class staleness found; nothing trivial to fix.

**Panels path (task 2.4):** `fetchPanels` (`panelThunks.ts`) `condition` returns `true` unless `loadedDashboardId === dashboardId` for a loading/succeeded panels slice. A brand-new applied dashboard id never matches `loadedDashboardId`, so it is fetchable on landing — no `markDashboardPanelsStale` needed for the new id.

## Spinoff candidate (not fixed here — per design Non-Goals)

- **MCP / out-of-band dashboard creates** (e.g. a dashboard created via the `apply_proposal` MCP tool while the app is open in another tab) still refresh the sidebar only on reload or navigation-to-idle — there is no SSE/polling of the dashboards list today. Out of scope for HEL-290; report as a spinoff candidate if an in-app live-refresh mechanism is deemed valuable.

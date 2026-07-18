# Refresh Sidebar After Apply Proposal (HEL-290)

## Why

After accepting a dashboard proposal (Proposal Review UI → `POST /api/dashboards/apply-proposal`), the sidebar
dashboard list stays stale — it can show "No dashboards yet" while the created dashboard renders in the main area.
Planning-level reading of the code shows the likely mechanism: `ProposalReviewPage.handleAccept` dispatches
`fetchDashboards()`, but that thunk has `condition: status === "idle"`, so the refetch is silently condition-blocked
whenever the dashboards list has already loaded — the store's `items` never gains the new dashboard, and
`setSelectedDashboardId` points at a dashboard the list doesn't contain. This must be probe-confirmed before fixing
(systematic-debugging Iron Law).

## What Changes

- Move the apply-proposal call into the dashboards slice as a proper `createAsyncThunk` (matching `duplicateDashboard`
  / `importDashboard`), whose `fulfilled` reducer inserts the created dashboard into `items` and selects it — no
  refetch needed, no dependence on the condition-gated `fetchDashboards`.
- `ProposalReviewPage` dispatches the new thunk instead of calling the service + `fetchDashboards` + manual select.
- Repro-widening audit (session directive): verify the other dashboard-creating/deleting flows —
  `createDashboard`, `duplicateDashboard`, `importDashboard`, `deleteDashboard` — already update `items` in their
  `fulfilled` reducers (reading suggests they do); fix any trivially-same-class miss, report bigger issues as
  spinoff candidates. MCP-driven out-of-band creates (no SSE/polling of the dashboards list exists) are out of scope.
- Unit tests for the new thunk's fulfilled/rejected reducer behavior.

## Capabilities

### New Capabilities

- `proposal-apply-dashboard-refresh`: after a dashboard proposal is applied from the Proposal Review UI, the Redux
  dashboards list immediately contains and selects the created dashboard, so the sidebar never shows a stale
  list/empty state.

### Modified Capabilities

(none — no existing spec covers the proposal-apply UI flow; other dashboard-mutation specs' requirements are unchanged)

## Impact

- `frontend/src/features/dashboards/state/dashboardsSlice.ts` — new thunk + reducer case.
- `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx` — dispatch the thunk.
- `frontend/src/features/dashboards/services/proposalService.ts` — unchanged service, now called from the thunk.
- Tests: `dashboardsSlice.test.ts` additions.
- No backend, schema, or API contract changes.

## Non-goals

- No change to the `fetchDashboards` `condition` semantics (other callers rely on the idle-only gate).
- No out-of-band (MCP/SSE/polling) sidebar refresh mechanism — spinoff candidate if deemed valuable.
- No visual/UX redesign of the Proposal Review UI.

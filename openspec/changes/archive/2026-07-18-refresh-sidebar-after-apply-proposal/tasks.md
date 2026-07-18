## 1. Probe (Iron Law: systematic-debugging)

### Frontend

- [x] 1.1 Probe-confirm root cause: demonstrate the post-apply `fetchDashboards()` dispatch is condition-blocked when `dashboards.status === "succeeded"` (unit-level dispatch probe or instrumented repro on the dev stack); record evidence in the change dir
- [x] 1.2 If the probe refutes the hypothesis, STOP and report back to the orchestrator instead of implementing

## 2. Slice thunk

### Frontend

- [x] 2.1 Add `applyProposal` async thunk to `frontend/src/features/dashboards/state/dashboardsSlice.ts` calling `applyDashboardProposal` (service aliased `*Request` per slice convention), with server-message passthrough in `rejectWithValue` (mirror `importDashboard`)
- [x] 2.2 Add `applyProposal.fulfilled` reducer: push created dashboard onto `items`, set `selectedDashboardId` (mirror `duplicateDashboard.fulfilled`)
- [x] 2.3 Update `ProposalReviewPage.handleAccept` to `dispatch(applyProposal(edited)).unwrap()`; remove the manual `fetchDashboards` + `setSelectedDashboardId` calls; keep `applying`/`applyError` local state and `navigate("/")` on success
- [x] 2.4 Verify the panels path treats the never-fetched new dashboard as fetchable on landing (no `markDashboardPanelsStale` needed for a brand-new id) — confirm by reading the panels slice fetch gate

## 3. Repro-widening audit

### Frontend

- [x] 3.1 Re-verify `createDashboard`/`duplicateDashboard`/`importDashboard`/`deleteDashboard` fulfilled reducers all mutate `items` (no same-class staleness); fix any trivially-same-class miss found; note anything bigger as a spinoff candidate in `files-modified.md`

## 4. Tests

### Tests

- [x] 4.1 `dashboardsSlice.test.ts`: `applyProposal.fulfilled` appends and selects the dashboard
- [x] 4.2 `dashboardsSlice.test.ts`: `applyProposal.rejected` leaves `items`/`selectedDashboardId` unchanged and carries the server error message
- [x] 4.3 Run gates: `npm run lint`, `npm test`, `npm run format:check` — all green

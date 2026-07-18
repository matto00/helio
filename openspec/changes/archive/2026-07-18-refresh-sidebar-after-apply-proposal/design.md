## Context

HEL-290: after accepting a dashboard proposal via the Proposal Review UI, the sidebar dashboard list is stale
(can show "No dashboards yet") while the created dashboard renders in the main area. Correct after reload.

Current code (worktree @ main):

- `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx` `handleAccept`:
  calls `applyDashboardProposal(edited)` (plain service, `frontend/src/features/dashboards/services/proposalService.ts`),
  then `await dispatch(fetchDashboards())`, then `dispatch(setSelectedDashboardId(dashboard.id))`, then `navigate("/")`.
- `frontend/src/features/dashboards/state/dashboardsSlice.ts` `fetchDashboards` is a `createAsyncThunk` with
  `condition: (_, { getState }) => getState().dashboards.status === "idle"` (line ~60). Once the list has loaded,
  `status === "succeeded"` and any later `fetchDashboards()` dispatch is **condition-blocked** — a no-op.
- Every other dashboard-creating flow updates `items` directly in its `fulfilled` reducer:
  `createDashboard` (push + select), `duplicateDashboard` (push + select), `importDashboard` (push + select),
  `deleteDashboard` (filter + reselect). Only the apply-proposal flow bypasses the slice entirely.

Hypothesized root cause (MUST be probe-confirmed by the executor before fixing, per `.concertino/laws/systematic-debugging`):
the post-apply `fetchDashboards()` is condition-blocked, so `items` never gains the new dashboard and
`selectedDashboardId` points at an id absent from `items`. The sidebar renders the stale list/empty state until
some later action re-populates it. A suitable probe: temporary logging (or unit-level dispatch assertion) showing
the thunk's condition short-circuits when `status === "succeeded"`, and/or Playwright repro on the dev stack.

## Goals / Non-Goals

**Goals:**

- Sidebar list contains and selects the newly created dashboard immediately after a successful apply.
- Apply-proposal joins the same slice pattern as the other dashboard mutations (thunk + fulfilled reducer).
- Audit the other create/delete flows for the same class of staleness; fix trivially-same-class misses only.

**Non-Goals:**

- Changing `fetchDashboards` condition semantics (App bootstrap and other callers rely on idle-only fetch).
- Out-of-band sidebar refresh for MCP-driven creates (no SSE/polling of the dashboards list exists today) — spinoff
  candidate, not this ticket.
- Backend/API changes. `POST /api/dashboards/apply-proposal` already returns the created dashboard.

## Decisions

1. **New thunk `applyProposal` in `dashboardsSlice.ts`** (name may be `applyDashboardProposal` thunk-side; keep the
   service import aliased as `*Request` per the slice's existing convention). Payload: `DashboardProposal`; returns
   `AppliedProposal` (or just its `dashboard`). Rationale: matches `duplicateDashboard`/`importDashboard` exactly —
   insert-on-fulfilled is the established staleness fix in this slice, is synchronous, and avoids a second network
   round-trip. Alternative considered: relaxing/bypassing the `fetchDashboards` condition (e.g. a `force` arg) —
   rejected: touches a shared gate other callers depend on, costs an extra request, and still leaves a fetch race.
2. **Fulfilled reducer mirrors `duplicateDashboard.fulfilled`**: `state.items.push(dashboard)` +
   `state.selectedDashboardId = dashboard.id`. Note `fetchDashboards` orders by lastUpdated desc and the newest
   dashboard would sort first; the existing push-pattern (used by create/duplicate/import) appends instead — keep
   consistent with that established behavior, do not invent new ordering logic here.
3. **`ProposalReviewPage.handleAccept`** dispatches the thunk via `.unwrap()`, drops the manual
   `fetchDashboards`/`setSelectedDashboardId` calls, keeps local `applying`/`applyError` state and `navigate("/")`
   on success. Error extraction moves into the thunk's `rejectWithValue` (server `message` passthrough, like
   `importDashboard`).
4. **Panels cache**: the applied dashboard's panels are created server-side, and the panels slice has never fetched
   them, so no `markDashboardPanelsStale` call is needed for the new id — but the executor MUST verify the panel
   fetch path treats a never-fetched dashboard as fetchable (this is the current behavior relied on by reload).
5. **Tests**: extend `dashboardsSlice.test.ts` with fulfilled (push + select) and rejected (error message) cases for
   the new thunk, mirroring the duplicate/import tests. A page-level test is optional; slice tests carry the
   behavior contract.

## Risks / Trade-offs

- [Hypothesis wrong — staleness has a different mechanism] → Iron Law probe before fixing; if the probe refutes the
  condition-block hypothesis, stop and re-plan rather than land a speculative fix.
- [Appended (not lastUpdated-sorted) list position differs from post-reload order] → identical to existing
  create/duplicate/import behavior; accepted, not a regression.
- [Double-submit while applying] → `applying` state already disables Accept; thunk keeps that behavior.

## Planner Notes

- Self-approved: introducing the thunk in the slice rather than a `force` refetch (Decision 1) — pattern-following,
  no architectural novelty.
- Repro-widening audit result (planning-level read, executor to re-verify): `createDashboard`, `duplicateDashboard`,
  `importDashboard`, `deleteDashboard` all mutate `items` in fulfilled reducers — no same-class staleness found in
  in-app flows. MCP out-of-band creates refresh only on reload/navigation-to-idle — report as spinoff candidate in
  the delivery summary, do not fix here.

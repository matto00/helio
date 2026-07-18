## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Root-cause hypothesis matches the code exactly.**
  - `frontend/src/features/dashboards/state/dashboardsSlice.ts:60` — `fetchDashboards` has
    `condition: (_, { getState }) => getState().dashboards.status === "idle"`. Confirmed verbatim; once the list
    has loaded once (`status === "succeeded"`), a later `dispatch(fetchDashboards())` is a documented Redux
    Toolkit no-op.
  - `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx:60-72` — `handleAccept` calls
    `applyDashboardProposal(edited)` (plain service call, bypassing the slice), then
    `await dispatch(fetchDashboards())`, then `dispatch(setSelectedDashboardId(dashboard.id))`, then
    `navigate("/")`. Matches design.md's "Current code" section line-for-line.
  - `proposalService.ts:7-15` confirms `applyDashboardProposal` is a bare axios POST with no Redux involvement —
    the created dashboard genuinely never reaches `items` via this path.
  - Given `App.tsx:251-253` unconditionally dispatches `fetchDashboards()` on mount, `status` is already
    `"succeeded"` by the time a user reaches the Proposal Review page in the normal flow, so the condition-block
    is the credible mechanism for the observed symptom (sidebar stale until reload/navigation re-triggers idle
    state or `selectedDashboardId` resolution).

- **Proposed fix pattern matches established convention exactly.**
  - `createDashboard.fulfilled` (line 230), `duplicateDashboard.fulfilled` (line 245), `importDashboard.fulfilled`
    (line 249), and `deleteDashboard.fulfilled` (line 239) in `dashboardsSlice.ts` all mutate `items` directly in
    the fulfilled reducer (push+select, or filter+reselect) with no refetch. The proposed `applyProposal` thunk
    mirroring `duplicateDashboard`/`importDashboard` (push + `selectedDashboardId = dashboard.id`) is the
    established, already-proven pattern in this exact slice — not a novel approach.
  - `importDashboard` (lines 151-169) already demonstrates the `rejectWithValue` + server-message-passthrough
    pattern the design specifies for `applyProposal`'s error path (Decision 3).
  - `AppliedProposal` (`frontend/src/features/dashboards/types/proposal.ts`) is `{ dashboard: Dashboard; panels:
    Panel[] }` — structurally identical in shape to `DuplicateDashboardResponse` (`{ dashboard, panels }` implied
    by the existing `duplicateDashboard.fulfilled`/`importDashboard.fulfilled` reducers reading
    `action.payload.dashboard`). The thunk's proposed return type and reducer wiring are a drop-in fit.

- **Decision 4 (no `markDashboardPanelsStale` needed) verified against the panels slice.**
  - `frontend/src/features/panels/state/panelThunks.ts:53-78` — `fetchPanels`'s `condition` only short-circuits
    when `panels.loadedDashboardId === dashboardId` (whether loading or succeeded). For a brand-new dashboard id,
    `loadedDashboardId` will not match, so the condition returns `true` and `fetchPanels` runs normally when
    `selectedDashboardId` changes (`App.tsx:255-261` effect). The design's claim holds up — no panel-cache
    invalidation is needed for the new id.

- **Repro-widening audit claim verified.** All four other dashboard-mutating flows
  (`createDashboard`/`duplicateDashboard`/`importDashboard`/`deleteDashboard`) update `items` synchronously in
  their own fulfilled reducers — confirmed by direct code read, not just design.md's assertion. No same-class
  staleness found elsewhere; audit conclusion in design.md/Planner Notes is accurate.

- **Test pattern fit.** `dashboardsSlice.test.ts:289-333` shows the existing `importDashboard.fulfilled` test
  shape (seed state via `fetchDashboards.fulfilled`, dispatch the mutation action, assert `items` length/order and
  `selectedDashboardId`). The planned `applyProposal` fulfilled/rejected tests (tasks.md 4.1-4.2) are directly
  modeled on this and are straightforward to write.

- **Iron Law scaffolding is present and correctly gated.** tasks.md 1.1-1.2 require a probe before any fix, with
  an explicit stop-and-report branch if the hypothesis is refuted. Per the orchestrator's brief, I am not
  penalizing the plan for the hypothesis being probe-*pending* rather than probe-*confirmed* at this stage — that
  confirmation is the executor's job, and the plan correctly refuses to skip it.

- **Spec testability/scope.** `specs/proposal-apply-dashboard-refresh/spec.md`'s three scenarios (loaded list,
  empty workspace, apply-fails) are each independently assertable against the fulfilled/rejected reducers and map
  1:1 onto tasks.md 4.1/4.2. No scope creep beyond the ticket's four ACs; non-goals explicitly fence off the
  `fetchDashboards` condition change and MCP/SSE refresh work, consistent with the ticket's "Non-goals" framing
  and the session directive to report bigger issues as spinoffs rather than fix them here.

### Verdict: CONFIRM

### Non-blocking notes

- The design's ordering trade-off (appended, not `lastUpdated`-sorted, until next `fetchDashboards`) is
  consciously accepted and matches existing create/duplicate/import behavior — not a new inconsistency introduced
  by this change.
- No contract/schema changes are implicated (backend `POST /api/dashboards/apply-proposal` response shape is
  unchanged) — correctly scoped as frontend-only.

## Files modified

- `frontend/src/features/dashboards/state/dashboardsSlice.ts` — added a shared `upsertDashboardById` helper (push-or-replace-by-id, the same shape `dashboardUpserted` already implemented) and switched `createDashboard.fulfilled`, `duplicateDashboard.fulfilled`, `importDashboard.fulfilled`, `applyProposal.fulfilled`, and `dashboardUpserted` to use it instead of a bare `.push(...)`. This is the confirmed root-cause fix for HEL-1119.
- `frontend/src/features/dashboards/state/dashboardsSlice.test.ts` — added the HEL-1119 probe/regression test: replays the confirmed race (a `fetchDashboards.fulfilled` refetch resolving first with a payload that already contains the new dashboard, then `createDashboard.fulfilled` for the same dashboard) and asserts exactly one entry survives.
- `frontend/src/features/pipelines/state/pipelinesSlice.ts` — `createPipeline.fulfilled` had the identical append-after-wholesale-replace shape (`fetchPipelines.fulfilled` fully replaces `items`, `createPipeline.fulfilled` then blindly pushed). Fixed inline with the same push-or-replace-by-id pattern since it was a small, mechanically identical change (per design.md Decision 3 / tasks.md 2.3).
- `openspec/changes/dedupe-dashboard-list-entries/tasks.md` — all 10 tasks marked complete.

## Root cause (systematic-debugging evidence)

- **Root cause (one sentence, failing layer):** In `dashboardsSlice.ts` (Redux reducer layer), `createDashboard.fulfilled` unconditionally `push`ed the newly created dashboard onto `items` with no de-dupe by id, so when a concurrent `fetchDashboards` refetch resolved *first* with a payload that already contained the new dashboard row (because the create had already committed server-side before the list-fetch request was served, but the create's own HTTP response was slower to arrive at the client), the wholesale-replacing `fetchDashboards.fulfilled` put the dashboard into `items` once, and the subsequent `createDashboard.fulfilled` pushed the same dashboard a second time.
- **Probe:** `frontend/src/features/dashboards/state/dashboardsSlice.test.ts`, new `describe("createDashboard / fetchDashboards race (HEL-1119)")` block — dispatches `fetchDashboards.fulfilled` with a payload already containing `dashboard-2`, then dispatches `createDashboard.fulfilled` for the same `dashboard-2`, and asserts `items.filter(d => d.id === "dashboard-2")` has length 1.
  ```
  npx jest --testPathPatterns=dashboardsSlice -t "HEL-1119"
  ```
- **Probe output (RED, against pre-fix code — `state.items.push(action.payload)` in `createDashboard.fulfilled`):**
  ```
  Expected length: 1
  Received length: 2
  Received array:  [{"id": "dashboard-2", ...}, {"id": "dashboard-2", ...}]
  Tests: 1 failed, 21 skipped, 22 total
  ```
- **Fix:** `createDashboard.fulfilled` (and the other same-shape sites, see below) now call `upsertDashboardById(state.items, action.payload)` — replace-by-id if the dashboard is already present, push only if genuinely new.
- **Post-fix (GREEN):**
  ```
  Tests: 83 passed, 83 total   (dashboardsSlice.test.ts + pipelinesSlice.test.ts)
  ```
- **Mutation check (guard is real, not vacuous):** reverted `createDashboard.fulfilled` back to a bare `state.items.push(action.payload)` (the exact pre-fix line) and re-ran the same probe — it went RED again with the identical "Expected length: 1, Received length: 2" failure. Then restored the fix; suite is green again. This is the exact mutation that turns the regression guard red.

## Skeptic notes addressed (design-gate, non-blocking)

1. **`duplicateDashboard.fulfilled` (line ~318), `importDashboard.fulfilled` (~325), `applyProposal.fulfilled` (~329)** — confirmed these use the identical bare-`push` shape as `createDashboard.fulfilled`. All three now route through `upsertDashboardById` too. None of these is the actual HEL-706 double-click surface (see below) — `createDashboard.fulfilled` (the one the ticket names) was the one the probe reproduces the race against; the sibling sites were fixed proactively as the same-shape, same-file, low-risk change the skeptic flagged, not because a probe implicated them specifically in the CI flake.
2. **Reused `dashboardUpserted`'s existing push-or-replace-by-id pattern** — extracted its logic into the new `upsertDashboardById` helper and had `dashboardUpserted` call it too, rather than duplicating a new branch.
3. **Task 3.3 (throttled-connection real-user visibility)** — investigated (see below); not a gate, reported below.

## HEL-706 relation (task 1.3)

**Distinct defect, not the same one.** HEL-706 ("duplicate buttons on step/dashboard/panel allow double-click double-clones") is a UI double-submission problem: a user double-clicking a create/clone control fires two independent backend requests, producing two real backend rows with two different ids for what the user experiences as one action. This ticket's confirmed root cause is a single backend row (one id) ending up twice in Redux `items` purely from reducer-level races between one create response and a concurrent list refetch — no double request, no double backend row, and an id-based de-dupe (this fix) has no effect on HEL-706's mechanism (two distinct ids can't be de-duped by id). The two are worth distinguishing explicitly: this fix does not address HEL-706, and HEL-706 (if real) will need its own submit-guard/disable-while-pending style fix.

## Sibling-slice scope check (task 2.3)

- **`pipelinesSlice.ts`** — same at-risk shape found (`fetchPipelines.fulfilled` wholesale-replaces `items`; `createPipeline.fulfilled` blindly pushed). Fixed inline (small, mechanically identical to the dashboards fix).
- **`sourcesSlice.ts`** (data sources) — `fetchSources.fulfilled` wholesale-replaces `items`, but there is no `push` anywhere in this slice; source creation does not append directly to `items`. Not at risk, no change needed.
- **`panelsSlice.ts`** — `fetchPanels.fulfilled` wholesale-replaces `items`, but there is no `createPanel.fulfilled` case in the `extraReducers` at all (panel creation goes through the `markDashboardPanelsStale`/refetch invalidation path instead of a direct push). Not at risk, no change needed.

## Real-user visibility (task 3.3, investigation only)

The race is genuinely user-triggerable, not just a test-timing artifact: `fetchDashboards()` is dispatched not only once on `App.tsx` mount, but also by `useResourceIndexing.ts` (command-palette open) — see `src/features/commandPalette/useResourceIndexing.ts:77`. A user who creates a dashboard and, before the create's own (slower) response returns, opens the command palette (or performs any other action that re-triggers a dashboards refetch) can reproduce the exact ordering the probe exercises on a real, sufficiently slow/throttled connection. This is a genuine, if narrow, real-user-visible defect, not purely a CI-timing artifact.

## e2e verification (task 3.2)

`e2e/focus-presence-guard.spec.ts` run locally against dev servers (`scripts/concertino/start-servers.sh`, ports 5273/8180):

```
DEV_PORT=5273 BACKEND_PORT=8180 npx playwright test e2e/focus-presence-guard.spec.ts --repeat-each=3 --workers=1
...
  ✓  1 e2e/focus-presence-guard.spec.ts:146:7 › HEL-520 focus-presence guard (AC2) › ... (2.2m)
  ✓  2 e2e/focus-presence-guard.spec.ts:146:7 › HEL-520 focus-presence guard (AC2) › ... (2.4m)
  ✓  3 e2e/focus-presence-guard.spec.ts:146:7 › HEL-520 focus-presence guard (AC2) › ... (2.2m)
  3 passed (6.8m)
[exited with code 0]
```

3/3 runs passed post-fix, with no strict-mode violation on any run — consistent with the reducer-level fix eliminating the duplicate this spec was intermittently catching.

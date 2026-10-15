## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD cd64409ad828d9024074f907a7ea32800ab71ff3 (planning artifacts uncommitted in the worktree). Inputs read: ticket.md, proposal.md, design.md, tasks.md, specs/\*/spec.md, workflow-state.md CONSTRAINTS, DESIGN.md §9, HANDOFF.md, B2Dashboard.png. Every code claim below was checked in the tree.

### What I verified (with evidence)

- **(a) Freshness on a warm in-session return: holds, with a caveat.** `pipelineRunFanout.ts` keeps `lastObservedRunIdByPipeline` for the page lifetime. `createEntry` seeds `lastObservedRunId` from it, so a resubscribe is not a first observation, and `reconcile` calls `invalidatePipeline` plus the listeners when `runs/latest` differs. `usePanelRunRefresh` maps the listener to `refresh()`. Caveat: `usePanelData.ts:246` decides `isReusable` synchronously at mount, before the async reconcile returns. If a run happened while the user was away, the card first shows the stale window and then refetches. That is still a correct refresh, and it matches existing HEL-1392 behaviour.
- **(a) Seeding the baseline after reload: the mechanism is sound.** A seeded `lastObservedRunIdByPipeline` entry makes the first reconcile after reload a real comparison. Seeding alone is not enough, though: see CR4 on generation restamping.
- **(b) D6 SQL under RLS: visibility is correct.**
  - `dashboards_select` and `panels_select` both use `helio_can_access_dashboard`, which is sharing-aware (V36).
  - `output_snapshot_history_select` uses `helio_can_access_pipeline(pipeline_id)` (V115/V39).
  - A grantee who has the dashboard but not the pipeline gets `dataUpdatedAt: null`. That is consistent with `GET /api/outputs/:id/rows`, which authorizes through `outputRepo.findById`'s sharing-aware select, so that grantee cannot read the rows either.
  - `GREATEST` ignores a NULL `MAX`.
  - Performance is a problem: see CR5.
- **(c) The panel-delete bump has no hidden correctness side effects.**
  - `PanelRepository.delete` is a single statement on `withSystemContext`.
  - V122's AFTER DELETE trigger already locks the dashboard row (`FOR UPDATE`). A follow-up `last_updated` update in the same transaction keeps the documented lock order (panels, then dashboards).
  - V127's layout-version trigger fires only when `layout` or `layout_version` changes, so a `last_updated`-only update leaves the CAS intact.
  - The one visible side effect: dashboard lists sort by `last_updated DESC` (`DashboardRepository.scala:61,159`), so a delete reorders them. The design states this.
  - V122 deliberately does not bump on cascades. That is still true, because only the direct delete path bumps. The consequence is in the notes.
- **(d) Selection listener: underspecified, and the hydrate race is real.** See CR3. `dashboardsSlice.ts` has 8 reducers that write `selectedDashboardId`: `setSelectedDashboardId`, `dashboardRemoved`, and the `.fulfilled` cases of `fetchDashboards`, `createDashboard`, `deleteDashboard`, `duplicateDashboard`, `importDashboard` and `applyProposal`. Separately, there are 7 _dispatch sites_ of `setSelectedDashboardId`. D1 conflates the two ("all seven writers, so the phone picker, palette…"). `recentVisitsListeners.ts` already records why a listener keyed on the action misses the reducers.
- **(e) IndexedDB against ruling 1.**
  - Per-user keys, the 1 MiB × 8 bounds, the allow-listed fields, the TTL purge and the purge of other users' entries at startup all satisfy the ruling.
  - Clearing on `clearAuth` covers both logout and the 401 path.
  - Generation, restore-sequencing and clear races are open: see CR4.
- **Own-edit and layout flush path.** `useLayoutSave.ts` (HEL-306 header) flushes a staged layout in its unmount cleanup. `usePanelUpdatesFlush.ts` owns "the dashboard-switch flush". `DashboardFieldWriteOps.scala:47` bumps `last_updated` on a layout write. So a deferred edit reaches the server after the tab's leave stamp. See CR1.
- **`capturedAt` basis.** D4/D5 define `capturedAt` as the instant of the last `fetchPanels` success. Rows are refetched later by SSE or reconcile refreshes, so this is the wrong basis for comparing against `dataUpdatedAt`. See CR2.
- **Accessibility of the close control.** In D8 the close control is a `<span role="button">` inside the `role="tab"`. Tab children are presentational in ARIA, so that "Close <name>" accessible name is not reliably exposed. See CR6.
- **(f) Scope.** One ticket is coherent: the server prefs key, the change endpoint, the warm cache, the tab UI and the palette ask action are all needed for the five ACs and four rulings. On the "OpenAPI" wording: `git ls-files | grep -i openapi|swagger` returns nothing, so `schemas/` plus the openspec specs are the contract, and task 1.3/2.2 schema updates cover it. Rulings 2 and 3 map to D3 and D10. Every AC has a task (8.1 e2e, 8.2 measurement).
- **Design fidelity.** The B2 board shows the accent top bar on the active tab, an inline × on each tab, "+", and the ⌘K box on the right. D8/D9 match. D7's non-accent dot follows §0/§9 accent discipline, overriding the board's sample colour, and that precedence is correct.

### Verdict: REFUTE

### Change Requests

1. **Own deferred edits will mark the dot and void the warm copy (D7 "own edits never mark", spec "Own edits do not mark", AC3).**
   - Helio persists layout and panel title/appearance edits on a deferred basis. They are flushed on dashboard switch (`useLayoutSave` unmount flush; `usePanelUpdatesFlush` dashboard-switch flush).
   - D7 stamps `lastViewedAt` when the selection changes, which is before that flush PATCH reaches the server. The server's `last_updated` is therefore later than the leave stamp, so the tab shows the dot. `contentUpdatedAt` is also later than `capturedAt`, so the next return refetches.
   - Required: define a rule that holds for flushed writes. For example:
     - record the server `last_updated` (or `layoutVersion`) from the client's own write responses for that dashboard, and treat any `contentUpdatedAt` at or below the latest own-write ack as "own"; or
     - stamp the leave time only after the switch flush settles.
   - Required: say how `capturedAt` advances on own edits ("the entry is refreshed whenever `panels.items` change" does not say whether `capturedAt` moves, or to what).
   - Required: add an e2e that drags a panel, switches tabs within 30s, and asserts no dot and a warm return.
2. **The row-invalidation basis is wrong (D4 sweep, D5 restore).**
   - `capturedAt` is the panel-list fetch instant, but row windows are refetched later. Example: a run finishes while the tab is active, and the SSE refresh refetches the rows. Its `dataUpdatedAt` is later than the old `capturedAt`, so every return within the TTL calls `invalidateOutput` and refetches. After a reload, the rows are dropped. The panel list is restored from warm state and never refetched, so `capturedAt` never advances and this repeats for the whole TTL.
   - Required: compare `dataUpdatedAt` against a per-window capture instant, i.e. the server time at that window's page-0 request start, stored with the window and in the IndexedDB entry. Or use per-output data times instead of the dashboard-level max.
   - Required: add a unit test for "run while active, leave, return: warm".
3. **Specify the selection listener and hydration ordering (D1, task 3.1/3.3).**
   - The listener must observe the `selectedDashboardId` state transition (the `recentVisitsListeners.ts` precedent), not the action, and must name the 8 writing reducers.
   - The listener must be inert until `hydrated`. Otherwise `fetchDashboards.fulfilled`'s auto-select of `getMostRecentDashboardId` (not `items[0]`) runs first and overwrites the saved active tab "in place".
   - State how the saved `activeId` wins without `App.tsx` dispatching `fetchPanels` for the auto-selected dashboard first.
   - State the precedence between a `/dashboards/:id` deep link and the saved `activeId`.
   - Define what happens when an open dashboard is deleted:
     - active: `deleteDashboard.fulfilled` and `dashboardRemoved` reselect the most recent dashboard, which as written replaces the deleted tab in place rather than applying the close-neighbour rule;
     - inactive: prune whenever `dashboards.items` changes, not only "once the dashboard list has loaded".
4. **Make the IndexedDB restore honour generations, ordering and the clear (D5, ruling 1).**
   - Hydrated row windows carry generations from the previous page lifetime, and the counters reset on load. `paginationHydrated` must restamp each window with `currentGeneration(outputId)`, after `seedOutputMeta` has called `registerOutputPipeline`. Otherwise `isReusable` fails and the reload is never warm, or it is warm against the wrong generation.
   - `showDashboardPanels` for the active tab must await the restore decision (change signals, then hydrate), or it falls through to `fetchPanels`. State this.
   - `pagehide`/hidden must stamp the active tab's `lastViewedAt`. Otherwise the TTL runs from activation, and a user who sat on A for 20 minutes and then reloads gets a cold load.
   - `clearWarmState` must:
     - cancel pending debounced writes, so a write cannot re-create `helio-warm` with the previous user's data after the delete;
     - drop writes whose `userId` is not the current user;
     - close the open IDB connection before `deleteDatabase`, which otherwise stays blocked past the 1s bound.
   - Add unit tests for the cancel and the restamp.
5. **Specify a D6 query shape that uses the index.**
   - `MAX(h.captured_at)` over `JOIN panels` cannot use the min/max index optimisation. It reads every history row of every bound Output: retention keeps up to about 101 + 288 + 168 + 365 points per Output, and the non-leakproof `helio_can_access_pipeline` is evaluated per row.
   - The endpoint is polled every 2 minutes per visible client, for up to 20 dashboards.
   - Required: specify the per-distinct-Output `LATERAL (SELECT captured_at … WHERE output_id = … ORDER BY captured_at DESC LIMIT 1)` form, or an equivalent shape that uses the index.
   - Required: record EXPLAIN ANALYZE in the PR as a done-check, not optional.
6. **Pin the close control as a sibling of the tab (D8, AC1 accessible tablist).** A `role="button"` nested in `role="tab"` is presentational, and its "Close <name>" name is not reliably exposed. Remove the "inside the tab" option. Make the close control a sibling, outside the tablist's tab elements or `aria-hidden` with keyboard close via Delete, and keep its accessible name testable.

### Non-blocking notes

- Task 6.3 "No dashboard open" overlaps the existing "Select a dashboard" `EmptyState` (`PanelList.tsx:465`, selection null with dashboards > 0). Replace that one rather than adding a second.
- Cascade panel deletes (Output, pipeline or source delete) still do not bump `last_updated` (V122, deliberate). A warm copy can then hold a panel that no longer exists. Its rows request then fails, which a cold load would not do. Accept and state it, or invalidate warm entries on Output-delete thunks.
- An in-session warm return after a run briefly shows the stale window until `runs/latest` resolves (pre-existing HEL-1392 behaviour). Mention this in the PR measurement method so the "warm" timing is not misread.
- A dashboard-only grantee also never gets a run baseline (`runs/latest` is pipeline-ACL'd), so their rows are never reusable. AC3's warm-switch claim should therefore be measured as the owner. State that grantee tabs are warm for the panel list only.
- The "seven writers" wording in D1 should become "the eight `selectedDashboardId`-writing reducers".

## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD cd64409ad828d9024074f907a7ea32800ab71ff3. The planning artifacts are uncommitted in the worktree.

Inputs read:

- ticket.md, proposal.md, design.md, tasks.md, all four spec deltas and workflow-state.md (C1-C7);
- skeptic-design-2.md;
- DESIGN.md §9.

Every code claim below was checked in the tree.

### What I verified (with evidence)

**CR1a (flush on leave): resolved, and it fits the code.**

- D4 now says that the switch flush is dead. That is correct:
  - `PanelList.tsx:411-412` renders `<PanelGrid key={selectedDashboardId}>`, and only when `items[0].dashboardId === selectedDashboardId`.
  - The effect at `usePanelUpdatesFlush.ts:130-143` returns early on its per-instance first render.
- The planned unmount flush will work, for these reasons:
  - **Timing.** The grid unmounts in the same commit in which the selection changes. Either the key changes, or `items` still belong to A and fail the match. React runs the cleanup of the unmounted grid's passive effects before the parent's new effects, so the flush is dispatched before `showDashboardPanels`/`fetchPanels(B)`.
  - **Payload.** `pendingPanelUpdatesRef` (`usePanelUpdatesFlush.ts:80-83`) holds the last committed value at unmount. `pendingPanelUpdates` is not cleared by `fetchPanels.pending` (`panelsSlice.ts:185-203`), only by `clearPendingPanelUpdates`/`resetPanelSaveState` (116-122).
  - **Effect on the next dashboard's panels.** `updatePanelsBatch.fulfilled` (273-277) maps over `items` by id. When the response arrives after the switch, it leaves B's panels untouched.
  - **Attribution.** Response panels carry `dashboardId` (`panelsMatchDashboard`, line 434). So D4's "attribute each response panel's own `dashboardId`" can be implemented as written.
  - **One instance.** `PanelGrid` mounts the hook once at every width (`PanelGrid.tsx:68`; `MobilePanelStack` only references it in a comment). So the flush fires once per leave.
- **C7 red-first is feasible.** A test can stage an update, remount `PanelGrid` with a new key, and assert `updatePanelsBatch` without advancing timers. On the current code it fails, because the new instance's first-render guard returns early and the old interval is cleared.
  - The existing HEL-304 3.3 test (`PanelGrid.test.tsx:654-689`) changes width without unmounting `PanelGrid`, so it is unaffected.

**CR1b (split dot rule): resolved.**

- D7 line 168 and the spec now read `content > max(lastViewedAt, ownWriteAt)` OR `data > lastViewedAt`.
- The spec adds the scenario "Own edits never hide new data".
- The unit test "own edit on A, leave, run on A, ack: dot shows" is in D12 and task 4.0.

**CR1c (persist `ownWriteAt`): resolved.**

- It is now an optional per-tab field in the server pref, in the D2 case class, the user-ui-preferences delta (validation) and task 1.1.
- It is PATCHed through the coalescer, and the IndexedDB entry is patched when it advances after leave (D4, D5 entry shape).
- The contradictory "not persisted server-side" wording is gone.

**CR1d (e2e coverage): resolved.** D12 lines 224-227 cover:

- title edit, switch, return;
- drag, switch, reload within the TTL;
- the second browser context.

**CR5 (D6 under RLS): resolved, and the outputs join is correct.**

- `outputs_select` is `helio_can_access_pipeline(pipeline_id)` (V94:238-240).
- `output_snapshot_history_select` uses the same function on its own `pipeline_id` (V115:41-43).
- No later migration redefines either policy (grep over all migrations).
- History `pipeline_id` is written as the Output's pipeline, and no code path updates an Output's `pipeline_id`. So an Output that survives the RLS-filtered `outputs` join has a newest history row that passes the same check, and the `LIMIT 1` index probe stops at one row.
- The `DISTINCT` derived table cannot be pulled up, so the LATERAL runs only for surviving Outputs. An inaccessible Output is removed by one function call per joined row, and its history is never walked.
- The inner join also drops unbound panels (`panels.output_id` is nullable, V94:344).
- The "per probed row, not per stored point" sentence is gone. The done-check (D6, task 2.3 and the spec scenario) now requires the dashboard-only grantee case with no per-history-row function evaluation.

**CR3 (restore timing): resolved.**

- D5 now picks one reading: only the target restores before `hydrated`; the others restore lazily on activation, bounded at 500ms.
- It states the never-clobber rules:
  - `paginationHydrated` skips existing windows;
  - the list restore is skipped when `loadedDashboardId` already matches;
  - `latestFetchRequestId` is never touched.
- Unit tests are required for these rules (D12, task 4.3).

**Other round-2 notes were absorbed:**

- the Context now cites `getMostRecentDashboardId`;
- the RTT offset trade-off is stated;
- a stored empty tab set stays empty, and auto-select applies only when no key exists;
- the empty-state description is adjusted;
- the touch-AT close limit is noted for the PR.

**Scope and contract.**

- All five ACs and rulings 1-4 map to tasks.
- C7 is a standing constraint with a red-first task (4.0).
- No new table, migration or dependency.
- The D8 tab indicator and the non-accent dot match DESIGN.md §9's accent discipline.

**New-defect check.**

- **Logout.** The unmount flush can fire after the session is gone. Logout calls `logoutRequest` and then `clearAuth` (`authSlice.ts:145-154`), and only then does the grid unmount. The interceptor (`httpClient.ts:31-44`) then dispatches `clearAuth` and navigates to `/login` again. That is harmless and has the same shape as the existing layout unmount flush. `noteOwnDashboardWrite` runs only on success, and in-flight IndexedDB writes are epoch-guarded (D5).
- **Lock order.** The D6 panel-delete bump keeps the panels-then-dashboards order that V129/V130 establish.

### Verdict: CONFIRM

### Non-blocking notes

1. **Where the flush lives.** Put the unmount flush in `usePanelUpdatesFlush` (mounted by `PanelGrid` at every width), using `useLayoutSave`'s ref plus empty-deps pattern. Do not put it in `DesktopPanelGrid`/`useLayoutSave`, because the phone picker also switches dashboards. "Mirroring `useLayoutSave.ts:332`" could be misread as a location.
2. **D7 wording.** The "Own edits" bullet still says "panel switch flush". It should say "panel unmount flush". The masked-collaborator trade-off is "about one round trip" plus the 2s `ownWriteAt` slack, which also applies to own writes made while the tab is active. Say so.
3. **Task 1.2 validation list.** It omits `ownWriteAt` (ISO-8601 or null). The spec delta and the schema (task 1.3) must carry it. Add a 400 case for a malformed `ownWriteAt`.
4. **Reload restore uses both copies.** In D5 step 2, use the later of the entry's `ownWriteAt` and the server pref's `ownWriteAt`. A debounced IndexedDB patch for an inactive tab may not have landed before `pagehide`, while the keepalive pref flush has.
5. **Batch success clears too much.** It clears all pending updates (`usePanelUpdatesFlush.ts:96`), including any edit staged on B during the round trip after leaving A. That race existed before, but the unmount flush makes it more likely. Consider clearing only the flushed keys.
6. **Blank frame during lazy restore.** While a lazy restore reads IndexedDB (up to 500ms), `status` is still "succeeded" with A's items, so `PanelList` renders neither the grid nor the skeleton (lines 111-114, 403-420). Show the skeleton during that wait.
7. **Proposal and spec wording.** The proposal and the dashboard-tabs "saved server-side" requirement list only the last-viewed time. Add `ownWriteAt` for consistency with the preferences delta.

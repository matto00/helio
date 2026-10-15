## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD cd64409ad828d9024074f907a7ea32800ab71ff3. The planning artifacts are uncommitted in the worktree.

Inputs read:

- ticket.md, proposal.md, design.md, tasks.md, specs/\*/spec.md and workflow-state.md;
- skeptic-design-1.md;
- DESIGN.md §9, §10 and §12.

Every code claim below was checked in the tree.

### What I verified (with evidence)

**CR2 (row-invalidation basis): resolved.**

- D4 now stamps a per-window `capturedAt` in `fetchPanelPage.pending`, and compares it against the per-Output `dataUpdatedAt`.
- D6 now returns `outputs[]`, and D5 step 5 restores per window.
- One residual imprecision, which is not blocking:
  - `captured_at` is a single `Instant.now()` taken at the start of `writesChain` (`PipelineRunSucceededWrites.scala:72,130`).
  - Node snapshots then commit sequentially afterwards, so a page-0 request that starts after `captured_at` can still read pre-run rows.
  - In session, the SSE `succeeded` event (published after the whole chain) bumps the pipeline generation. After a reload, the seeded `runBaseline` makes the reconcile catch it. So the timestamp comparison is only a fast path, and correctness rests on the baseline. That holds.

**CR3 (selection listener and hydration): resolved.**

- `dashboardsSlice.ts` has exactly 8 `selectedDashboardId` writers (lines 369, 419, 442, 483, 501, 509, 516, 520), and D1 names all of them.
- D1 now specifies:
  - a state-transition listener;
  - inert until `hydrated`;
  - removal, new, open and replace rules;
  - deep link over saved `activeId` over auto-select.
- The `App.tsx:168-174` panel effect is gated on `hydrated`.
- Pruning runs on every `items` change.
- I checked the other `fetchPanels` dispatch sites (`App.tsx:114`, `panelThunks`, `useLayoutSave:175`, `PanelList:339`, onboarding, patch sets). None preempts hydration on the dashboard view.
- `fetchDashboards` is otherwise re-dispatched only from the palette when its status is idle or failed (`useResourceIndexing.ts:76`). So the auto-select in the reducer cannot undo a "closed all tabs" state mid-session.

**CR4 (IndexedDB restore): resolved as written.**

- `currentGeneration` is the sum of the global, Output and pipeline counters (`outputFreshness.ts:28`). Restamping after `registerOutputPipeline` is therefore correct.
- The ordering, the pagehide/hidden stamp, and the epoch, cancel and close-before-delete steps are all specified, with unit tests in D12/4.4.
- `release()` on a missing entry is a no-op (`outputFreshness.ts:79`), so `clearWarmState` releasing after `resetOutputFreshness` is safe.
- One ambiguity remains: see CR3 below.

**CR6 (close control): resolved.**

- The close control is now a sibling `aria-hidden` button with `tabIndex=-1` in a presentation wrapper.
- Delete/Backspace closes, advertised through `aria-keyshortcuts` and a description.
- Tests assert that the tab's accessible name has no "Close".
- The tablist now owns only tabs.

**CR1 (own deferred edits): not resolved.** The fix depends on a flush that does not run, and on state that does not survive a reload or a second device. See CR1 below.

1. **The panel-update switch flush the design relies on never runs.** D4 cites "the `usePanelUpdatesFlush` switch flush".
   - `PanelList.tsx:412` renders `<PanelGrid key={selectedDashboardId}>`, so a switch remounts the grid.
   - The switch effect in `usePanelUpdatesFlush.ts:130-142` is guarded by a per-instance `isFirstRenderRef` and returns early in the new instance. It never flushes on a switch.
   - `pendingPanelUpdates` are optimistically merged into `items` (`panelsSlice.ts:101-114`). They stay in global state and are sent by the _next_ grid's 30s interval (`usePanelUpdatesFlush.ts:121-128`).
   - So an own title or appearance edit on A reaches the server up to 30s after leaving A.
   - The layout path really does flush on unmount (`useLayoutSave.ts:332`).

2. **The dot formula lets own writes mask data changes.**
   - D7's rule is `max(contentUpdatedAt, dataUpdatedAt) > max(lastViewedAt, ownWriteAt)`, so `ownWriteAt` masks _data_ as well as content.
   - Combined with the up-to-30s flush in item 1, a pipeline run that lands within 30s after leaving A, while an edit is pending, never shows a dot.
   - That violates ruling 4 and the spec scenario "Data arrives while away".
   - The spec text says only the user's own _content_ changes are excluded.

3. **The warm panel list can hide a collaborator's edit.**
   - `contentUpdatedAt` is a single max, so a collaborator's panel edit inside the 30s pre-flush window satisfies `contentUpdatedAt <= ownWriteAt`.
   - The warm entry is then served on return, without the collaborator's change, until the TTL ends.
   - D7's "accepted trade-off" assumes this window is one flush round trip, not 30s.

4. **`ownWriteAt` does not survive a reload or a second device.**
   - D4/D5 keep `ownWriteAt` in memory and in the IndexedDB entry only ("not persisted server-side"). D4 also says "persisted with the tab", which contradicts this.
   - The IndexedDB entry is written when the tab is left, before the flush ack advances `ownWriteAt`, and nothing rewrites it afterwards.
   - After a reload, D5 step 2 sees `contentUpdatedAt > max(contentCapturedAt, ownWriteAt)` from the entry. It drops the copy (cold), and A shows a dot for the user's own edit.
   - On a second device, `lastViewedAt` comes from the server and was stamped at leave, before the flush. The same own edit shows a dot there.
   - The spec says a copy is used unless there is a content change "other than the user's own", and that own writes "SHALL NOT count". Neither is scoped to one page lifetime.

**CR5 (D6 query shape): resolved for the owner only.**

- The LATERAL `ORDER BY captured_at DESC LIMIT 1` probe uses `(output_id, captured_at DESC)` (V115:36) when the newest row passes RLS.
- But `output_snapshot_history_select` is `helio_can_access_pipeline(pipeline_id)` (V115:41-43), a plpgsql `SECURITY DEFINER` function (V39:28).
- For an Output whose pipeline the caller cannot access, no row passes, so the `LIMIT 1` scan walks every history point of that Output and evaluates the function on each one.
- A dashboard-only grantee is exactly the case D4/D6 call out. For that user the query is "per stored point", contrary to D6's claim that the predicate is "evaluated per probed row, not per stored point".
- The done-check measures the owner only, so it cannot catch this.
- `outputs_select` uses the same function (V94:238-240). Joining `outputs` in the derived table removes inaccessible Outputs before the LATERAL runs, at one function call per Output.

**Scope and contract.**

- There is still no OpenAPI document. The `schemas/` deltas are listed in tasks 1.3/2.2.
- All five ACs and rulings 1-4 map to tasks.
- DESIGN.md §9 is consistent: the tab indicator and the accent discipline for the dot, the `⌘K` text, and "No dashboard title" (the sr-only h1 is a visually hidden accessible name).
- §10 is consistent: static motion, no new tokens.
- §12 is consistent: no strip at or below 768px.

**Palette and Assistant claims checked:**

- `useCommandQuery` (`hooks.ts:25`), `matchesQuery` (`types.ts:30`) and `SECTION_DISPLAY_ORDER` (`builtInActions.ts:32`) exist.
- `ChatPage` captures `state.draft` once and clears it (`ChatPage.tsx:26,45-50`).
- The `command-palette` shortcut is in `shortcuts.ts:38`.

### Verdict: REFUTE

### Change Requests

1. **Finish CR1: make own-write exclusion correct for flush timing, data, reload and a second device.** All four parts are required.
   - (a) **Correct the premise in D4.** The `usePanelUpdatesFlush` switch flush is dead under `PanelList.tsx:412`'s `key`. Do one of the following:
     - flush pending panel updates when the tab is left, for example in `PanelGrid`'s unmount cleanup, the same way `useLayoutSave.ts:332` flushes layout. Then the D7 trade-off window really is one round trip;
     - or state and handle the up-to-30s deferred flush explicitly.

     Either way, `noteOwnDashboardWrite` for a batch update must attribute each response panel's own `dashboardId`, not the currently selected dashboard.

   - (b) **Split the dot rule in D7.** Show the dot when `contentUpdatedAt > max(lastViewedAt, ownWriteAt)` OR `dataUpdatedAt > lastViewedAt`. Own writes must never mask data. Add a unit test: own edit on A, leave, run on A, ack. A must show the dot.
   - (c) **Persist `ownWriteAt` so reload and other devices honour it.** For example:
     - add an optional `ownWriteAt` per tab to the server `dashboardTabs` pref (validation in the `user-ui-preferences` delta and in the schema), PATCHed through the same 1000ms coalescer when it advances;
     - and rewrite or patch the tab's IndexedDB entry's `ownWriteAt` when it advances after leave.

     Remove D4's contradictory "persisted with the tab … not persisted server-side" wording.

   - (d) **Extend the D12 e2e.** Cover a panel title edit, then switch, then return (no dot, warm). Cover the drag case followed by a reload within the TTL (no dot, warm). Cover a second browser context (no dot).

2. **Finish CR5: bound the inaccessible-pipeline case in D6.**
   - Restrict the derived table to accessible Outputs before the LATERAL, e.g. `JOIN outputs ot ON ot.id = p.output_id`, which is RLS-filtered by `outputs_select`. Or use an equivalent guard that evaluates the access check once per Output rather than once per history row.
   - Correct the "per probed row, not per stored point" sentence.
   - Extend the EXPLAIN (ANALYZE, BUFFERS) done-check in D6, task 2.3 and the spec scenario to also run as a dashboard-only grantee (no pipeline grant). It must stay under the same bound and must show no per-history-row function evaluation.

3. **Remove the restore-timing ambiguity in D5.** "Runs this for the warm tabs, the target first, before `showDashboardPanels` is allowed to run" can be read two ways:
   - all 8 warm tabs restore before `hydrated`;
   - or only the target does, and the others restore later.

   Pick one. If the others restore asynchronously, state that `paginationHydrated` and the panel-list seed never overwrite an existing `paginationState` window or a loaded or in-flight panel list for that dashboard. Otherwise a late restore can clobber a fresher window or an in-flight `latestFetchRequestId`. Add a unit test for the chosen rule.

### Non-blocking notes

- The Context bullet still says `fetchDashboards.fulfilled` "auto-selects `items[0]`". The reducer uses `getMostRecentDashboardId` (`dashboardsSlice.ts:442-444`), as D1 itself now says.
- `serverOffsetMs` is measured as `serverNow - Date.now()` on arrival, so it carries up to one RTT of error, and `contentCapturedAt` has no compensating slack. A collaborator write committed within about one RTT of the panel-list request start can be judged as captured. It is narrow and tolerable, but worth a sentence.
- A user who closes every tab and then reloads with a stored `{tabs: [], activeId: null}` falls to D1 step 2's auto-select, which reopens a tab. State whether that is intended. A stored empty set could instead leave "No dashboard open".
- The PanelList empty state's description still says "Choose a dashboard from the sidebar"; adjust it together with the title in 6.3.
- A touch-only assistive-technology user on a tablet (strip shown above 768px) has no close path, because the close control is `aria-hidden` and Delete needs a keyboard. Acceptable per the APG deletable-tabs pattern, but worth noting in the PR.

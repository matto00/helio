## Context

See proposal.md - Why, and ticket.md for the owner rulings (1-4) that bind this design. Current state (surveyed 2026-10-15, worktree at cd64409ad):

- **Selection is Redux-only.** `dashboards.selectedDashboardId` is the single source. `/home` carries no id, `/dashboards/:id` pushes its param one way (`DashboardRoute`), and `fetchDashboards.fulfilled` auto-selects the most recent dashboard (`getMostRecentDashboardId`) when the selection is missing. The context list (`DashboardList.tsx:287`) is a `<button>` that dispatches `setSelectedDashboardId`, with no middle-click or meta-click handling. The palette's `useResourceNavigator` selects the dashboard and navigates to `/home`.
- **Panels hold one dashboard.** `panels.items`/`loadedDashboardId`. `App.tsx:168-174` dispatches `fetchPanels(selectedDashboardId)` on every selection change. The thunk skips only when the same id is already loading or loaded, so A→B→A always refetches A's panel list.
- **Rows already have a reuse path (HEL-1392).** `panels.paginationState` is keyed by panel id and is never cleared on a switch. `usePanelData` reuses a window when `panelRowsReuse.isReusable` holds: the same query, `isRetained(outputId)` (ref-count, or within `REMOUNT_GRACE_MS` = 30s of the last release), the generation unchanged (`outputFreshness`), and a run baseline for the pipeline (`pipelineRunFanout.hasRunBaseline`). Output metadata (`outputMetaCache`) is served under the same retained-and-same-generation rule. A remounting card re-subscribes to its pipeline's run fan-out. That subscription reconciles via `GET /api/pipelines/:id/runs/latest` and bumps the pipeline generation when the latest terminal run differs from the one last observed. The first observation per page lifetime never notifies.
- **Logout** (`authSlice.logout`) calls `resetOutputFreshness()` (which also clears `outputMetaCache` and the run baselines) and `clearAuth`. `panels`/`dashboards` slices are not reset; a 401 dispatches `clearAuth` directly.
- **Preferences**: the `users.preferences` JSON column, written by a merge (`jsonb ||`) through `PATCH /api/users/me/preferences` (`UserPreferencesRoutes`, allow-listed keys) and delivered on every user-returning auth response via `UserResponseAssembler`. `users` has no RLS by design (V88); isolation is application-level, tested in `UserPreferencesRoutesSpec` on `TwoUserRlsApiFixture`. That fixture's app pool runs as `helio_app_test NOSUPERUSER NOBYPASSRLS`.
- **Change data.**
  - `dashboards.last_updated` is bumped by the dashboard PATCH (name, appearance, layout), auto-layout, panel create/duplicate (`PanelLayoutPlacement.insertAndAppend`) and contents replace. It is not bumped by layout repair, panel delete, or panel title/appearance/config edits; those edits bump `panels.last_updated` only.
  - `output_snapshot_history` gets one row per Output per real, unblocked, successful run (V115), with index `(output_id, captured_at DESC)` and sharing-aware RLS.
  - `pipeline_runs` keeps only 10 runs, and grantee-triggered runs have no row, so it is not a usable signal.
  - Nothing tracks last-viewed time server-side.
- **Palette.** `CommandAction.run()` takes no arguments. Query-dependent actions are built in hooks that read `useCommandQuery()` (as `useResourceSearchActions` does). Sections are ordered by `SECTION_DISPLAY_ORDER`. `matchesQuery: true` bypasses local filtering.
- **Assistant.** `/chat` accepts router state `{draft}` (prefill only). The first-message send path (`createConversation` → `conversationCreated` → `setSelectedConversationId` → `converse` with an idempotency key) lives inside `MessageComposer.handleSubmit`.
- **Shell.** `.app-shell` is a grid: rail, list, then the content column (`CommandBar` in row 1, `.app-body` in row 2). The only `role="tablist"` today is on the pipeline detail page. There is no drag-and-drop library; `StepCardHeader` uses native HTML5 drag.

## Goals / Non-Goals

**Goals:** the ticket's five acceptance criteria and owner rulings 1-4, built on the existing preferences store and the existing freshness machinery rather than beside them.

**Non-Goals:**

- the meta row, title/undo relocation and grid gutters (HEL-1576);
- tab motion (HEL-1573/1584: static now, no new motion tokens);
- phone chips and glass nav (HEL-1583);
- Home's own ⌘K box placement (HEL-1578, which can reuse the box component);
- live cross-device sync of an open session's tabs (last write wins);
- fixing the pre-existing non-reset of `outputHistoryCache`/`provenanceCache`/`panels` on logout (a follow-up is filed if confirmed).

## Decisions

**D1 Tab model and selection (revised r1, CR3).** A new `dashboardTabs` Redux slice holds `{tabs: [{id, lastViewedAt}], activeId, hydrated}`. Selection (`dashboards.selectedDashboardId`) stays the single source of which dashboard is shown.

- **The listener watches the state transition, not an action.** A listener-middleware predicate compares the previous and current `selectedDashboardId`, the precedent being `recentVisitsListeners.ts`. It therefore sees every one of the **eight** writing reducers in `dashboardsSlice.ts`: `setSelectedDashboardId`, `dashboardRemoved`, and the `.fulfilled` cases of `fetchDashboards`, `createDashboard`, `deleteDashboard`, `duplicateDashboard`, `importDashboard` and `applyProposal`.
- **It is inert until `hydrated`.** For a transition from P to X after hydration:
  - **Removal:** P is no longer in `dashboards.items` (`deleteDashboard`/`dashboardRemoved`). The slice applies `closeTab(P)`'s neighbour rule and dispatches `setSelectedDashboardId(neighbour | null)`, overriding the reducer's most-recent pick. Re-entry is guarded by an `applyingSelection` flag.
  - **New dashboard:** X was not in the previous `dashboards.items` (create, duplicate, import, apply-proposal). X opens as a new tab after the active one and becomes active.
  - **Already open:** X becomes active.
  - **Otherwise:** X replaces the active tab's id in place, or becomes the only tab when there are none. X = null leaves the tabs as they are with no active tab.
- **Explicit actions.** `openTabInBackground(X)` inserts after the active tab without changing the selection (a no-op if X is open). `openTabActivate(X)` inserts after the active tab, then selects. `activateTab(X)` selects. `closeTab(X)` closes; closing the active tab selects the right neighbour, else the left, else null. `moveTab(X, toIndex)` reorders.
- **Pruning.** Whenever `dashboards.items` changes after the first successful load, tabs whose id is no longer present are removed (after the removal rule above for the active one), and the pruned set is written back.
- **No tab open.** With no active tab, the dashboard view shows the existing `PanelList` "Select a dashboard" `EmptyState` (`PanelList.tsx:465`), with copy adjusted to "No dashboard open" / "Choose a dashboard from the list, or press ⌘K.". No second empty state is added. A stored empty tab set (`{tabs: [], activeId: null}`, the user closed everything) is respected on reload: hydration does not auto-select, and the empty state shows. Auto-selection applies only when the user has no saved `dashboardTabs` key at all.
- **Hydration (`hydrateTabs`), which runs once per signed-in user.** Preconditions: the auth user is known (preferences are on the auth response), and `fetchDashboards` has succeeded. Steps:
  1. Prune the saved tabs against the list.
  2. Choose the target:
     - a `/dashboards/:id` deep link on the current URL wins. It opens as a new active tab, or activates it if already open, so the saved set is never overwritten. The first-run landing uses this route.
     - otherwise the saved `activeId`, if still present.
     - otherwise the reducer's existing auto-selection, which becomes the only tab.
  3. Await the warm restore decision for the target (D5, bounded at 3s; a failure means cold).
  4. Dispatch `setSelectedDashboardId(target)`.
  5. Set `hydrated`.
- **Panel loading waits for hydration.** `App.tsx`'s panel effect dispatches `showDashboardPanels(selected)` only once `hydrated` is true, so no `fetchPanels` is issued for the auto-selected dashboard before the saved active tab is chosen. If the user's preferences carry no `dashboardTabs`, hydration completes immediately after the list loads (no change-signal wait).
- **Alternative rejected:** "every selection opens a new tab". The ticket's "middle-click or ⌘-click opens a new tab" implies a plain click does not, and growth would hit the 20-tab cap constantly.

**D2 Persistence (ruling 1, store extended).** A new preferences key `dashboardTabs: {tabs: [{id, lastViewedAt, ownWriteAt}], activeId}` (`ownWriteAt` optional, D4), written through the existing `PATCH /api/users/me/preferences`. It replaces the whole key, so the merge semantics for other keys are unchanged.

- Server validation as specified in `user-ui-preferences`. `getPreferences` drops an invalid stored value wholesale (treated as never set), matching the existing drop-invalid style.
- `UserPreferences` gains `dashboardTabs: Option[DashboardTabsPref]` with new case classes `DashboardTabsPref(tabs: Vector[DashboardTabPref], activeId: Option[String])` and `DashboardTabPref(id: String, lastViewedAt: Option[String], ownWriteAt: Option[String])`. Their JSON Schema titles match, so the drift checker covers them. `UserResponseAssembler` carries the key, which brings it to `/me`, login, register, OAuth, MFA and beta redeem.
- Client writes are coalesced at 1000ms trailing. A pending write is flushed on `visibilitychange`→hidden and `pagehide` with `fetch(..., {method: "PATCH", keepalive: true, credentials: "include"})` and the CSRF header, so the last change survives a reload.
- Failure keeps local state, with no toast (HEL-1574 D2 precedent).
- Concurrency across devices is last-write-wins on the whole key, which is accepted (Non-Goals).
- `lastViewedAt` is stamped in server time (D7 offset) when a tab is activated and when it is left.
- No Flyway migration (V135 stays free).

**D3 Cap and eviction (ruling 2).** At most 20 tabs. Adding a tab when 20 are open first removes the inactive tab with the oldest `lastViewedAt` (null counts as oldest, ties broken by position from the left). The strip scrolls horizontally with no visible scrollbar chrome beyond the platform's. The active tab is scrolled into view on activation, and the overflow is reachable by keyboard focus (focusing a tab scrolls it into view).

**D4 Warm set and TTL (rulings 1-2; revised r1, CR1/CR2).** `WARM_TTL_MS = 15 * 60_000` and `WARM_MAX = 8` are named constants in one module.

- A tab is warm when it is among the 8 open tabs with the latest `lastViewedAt` and `serverNow - lastViewedAt <= WARM_TTL_MS`. The active tab is always live.
- **Clock.** Every capture time below is in **server time**, `Date.now() + serverOffsetMs` (D7).
- **Panel list.**
  - The in-memory warm store (module-level, keyed by user, cleared per D5) maps `dashboardId → {panels, contentCapturedAt}`.
  - `contentCapturedAt` is set to the server-time instant at the _start_ of the `fetchPanels` request that produced the list.
  - Whenever `panels.items` change for the loaded dashboard (the user's own edits), the entry's panels are replaced and `contentCapturedAt = max(contentCapturedAt, ownWriteAt[dashboardId])`.
  - The entry is valid when the tab is warm and `contentUpdatedAt <= max(contentCapturedAt, ownWriteAt[dashboardId])`.
  - `showDashboardPanels(id)` restores a valid entry through a new `panelsRestored({dashboardId, items})` reducer. It applies the same resets as `fetchPanels.pending` (interaction state, cross-filter), sets `status: "succeeded"`, and issues no request. Otherwise it dispatches `fetchPanels`.
- **Own writes (CR1; revised r2).**
  - `ownWriteAt` is the server-time instant at which the client _received_ the success response of its own content write for that dashboard, plus 2s slack for offset error. The receipt follows the server commit, so it is at or after the write's `last_updated`.
  - It is recorded by `noteOwnDashboardWrite(dashboardId)` on the success path of every client content-write path:
    - dashboard PATCH (name, appearance, layout, including the `useLayoutSave.ts:332` unmount flush);
    - panel create, duplicate, update, batch update and delete;
    - auto-layout;
    - apply proposal / patch set.
  - Batch panel updates attribute each response panel's **own** `dashboardId`, never the currently selected one.
  - The executor enumerates these paths by grep over `services/*` calls that hit `/api/dashboards/:id` (PATCH/POST) and `/api/panels*`, and lists them in a test table.
- **Flush on leave (CR1a).**
  - Today the `usePanelUpdatesFlush` "switch flush" never runs: `PanelList.tsx:412` keys `<PanelGrid>` by `selectedDashboardId`, so a switch remounts the grid and the effect sees a first render.
  - As a result, pending panel title/appearance edits wait for the next grid's 30s auto-save.
  - This change adds an **unmount flush** for pending panel updates in the grid, mirroring `useLayoutSave.ts:332`. It dispatches the existing batch save for the leaving dashboard's pending updates when the grid unmounts.
  - The own-write ack therefore lands one round trip after leaving.
- **Persisted with the tab.** `ownWriteAt` is stored per tab in the server `dashboardTabs` pref (`{id, lastViewedAt, ownWriteAt}`, see D2), PATCHed through the same 1000ms coalescer whenever it advances.
- **Kept in sync locally.** When it advances after a tab was left, that tab's IndexedDB entry is patched too. A reload or a second device therefore honours it.
- **Rows (CR2).**
  - Each `paginationState` window gains `capturedAt`: the server-time instant at the _start_ of its latest page-0 request, set in `fetchPanelPage.pending`. A refresh after a run therefore moves it forward.
  - A warm row window is invalidated (`invalidateOutput`, the existing freshness bump) only when that **Output's** `dataUpdatedAt` (D6 now returns it per Output) is later than the window's `capturedAt`.
  - Otherwise the existing reuse path decides. A warm tab's dashboard holds a tab-level `retain(outputId)` on every Output bound to its panels, taken when the tab is left and released on TTL expiry, close, eviction from the warm 8, or `clearWarmState`. This keeps `isRetained` true across the 15 minutes, so `isReusable` and `outputMetaCache` serve it, still gated by generation and run baseline.
  - A once-a-minute sweep (only while tabs exist) releases expired retentions.
- **Correctness while away.**
  - A remount re-subscribes the run fan-out. That subscription is not a first observation (`createEntry` seeds from `lastObservedRunIdByPipeline`), so a run that finished while the user was elsewhere bumps the generation and refreshes the card.
  - The reuse decision is made at mount, before the async reconcile returns, so such a card shows its previous rows briefly before refreshing. This is pre-existing HEL-1392 behaviour, stated in the PR measurement method.
  - The AC's no-refetch claim is measured with nothing changed, as the owner. A dashboard-only grantee never gets a run baseline (`runs/latest` is pipeline-ACL'd), so the grantee's tabs are warm for the panel list only, which is stated.
- **Alternatives rejected.**
  - Keeping inactive tabs mounted (hidden) would mean N live grids, and N SSE fan-outs against the browser's 6-connection HTTP/1.1 limit, and `panels` holds only one dashboard.
  - Per-dashboard `panels` state would be a broad refactor of the slice.

**D5 Browser-stored copy (ruling 1; revised r1, CR4).**

- **Store.** IndexedDB database `helio-warm` (v1), object store `entries`, key `${userId}:${dashboardId}`.
- **Entry shape.** `{v: 1, userId, dashboardId, contentCapturedAt, ownWriteAt, lastViewedAt, panels, rows, outputMeta, runBaseline}`:
  - `rows`: `Record<panelId, PanelPaginationState>` restricted to settled `lastFetchOk` windows, each with its `capturedAt`;
  - `outputMeta`: `Record<outputId, OutputMeta>`;
  - `runBaseline`: `Record<pipelineId, runId>` from the fan-out's observed map.
- **Writes.**
  - When a warm tab is left.
  - For the active tab on `visibilitychange`→hidden and on `pagehide`. Those two events also stamp the active tab's `lastViewedAt` and flush the tab PATCH (CR4: otherwise the TTL would run from activation).
  - While open (final-gate r2, D4/D5 revised): the active tab's copy is also written on a debounce once its windows settle and on a 60 s heartbeat, carrying a LOCAL "seen now" `lastViewedAt`. These writes touch only IndexedDB and dispatch nothing, so they never cause a preferences PATCH (an idle device would otherwise keep re-writing its stale tab set over another device's, defeating AC2). The server is written only by user actions (open, close, reorder, activate, leave) and the hidden/pagehide `keepalive` flush. On reload, the copy's `lastViewedAt` is honoured for the target's TTL check when it is later than the saved one.
  - Writes are debounced, off the interaction path, and go through one `WarmStore` handle that carries the user id and an epoch.
- **Bounds.**
  - An entry whose `JSON.stringify` exceeds 1 MiB is not stored, and any older copy for that key is deleted.
  - After each write, the user's entries beyond the 8 latest `lastViewedAt` are deleted, as are all entries past the TTL.
  - On startup, every entry whose `userId` is not the signed-in user's is deleted.
- **Restore on reload (revised r2, CR3).** Only the **target** tab (D1 step 2) is restored before `hydrated`, which keeps first paint fast. The other warm tabs are restored **lazily on activation**: `showDashboardPanels(id)` reads that tab's entry (bounded at 500ms), validates it against the latest change signals, and restores it or falls back to `fetchPanels`. Either way the steps run in this order:
  1. Fetch the change signals (D6) once, at hydrate.
  2. If `contentUpdatedAt > max(contentCapturedAt, ownWriteAt)`, drop the copy. Otherwise seed the panels into the in-memory warm store.
  3. Seed `outputMeta` through a new `seedOutputMeta(outputId, meta)`. It calls `registerOutputPipeline` and stamps the current generation.
  4. Seed `runBaseline` through a new `seedObservedRun(pipelineId, runId)`. This makes the first reconcile after reload a real comparison, not a silent first observation.
  5. Hydrate row windows whose Output's `dataUpdatedAt <= window.capturedAt` with a new `paginationHydrated` reducer. It **restamps each window's `generation` with `currentGeneration(outputId)`**, read after step 3, because the counters reset on load.
  6. Take the tab-level retentions.

  **Never clobber.** A restore of either kind must not overwrite fresher state:
  - `paginationHydrated` skips any panel that already has a `paginationState` window (settled or in flight);
  - the panel-list restore is skipped when `panels.loadedDashboardId` is already that dashboard (loaded or loading);
  - seeding never touches `latestFetchRequestId`.

  These rules are unit-tested.

- **Restore failures.** If the change request fails or exceeds 3s, nothing is restored: the load is cold, which is honest.
- **No secrets.** Only dashboard, panel, output metadata and row data the user already sees. No session, token, share link, credential or request header. A unit test asserts every stored entry's keys against an allow-list.
- **Clearing (`clearWarmState`, CR4).** It runs on `clearAuth`, which covers both logout and the 401 path:
  1. Bump the epoch and cancel every pending debounced write timer. A write already in flight checks the epoch and user id before `put` and aborts on a mismatch.
  2. Clear the in-memory store and `ownWriteAt`, and release every tab retention.
  3. `close()` the open IDB connection.
  4. Then `indexedDB.deleteDatabase("helio-warm")`.
- `logout` awaits the clear, bounded at 1s, before navigating.
- **Fallback and testability.** If IndexedDB is unavailable (private mode, test env), the store degrades to memory only, without errors. Storage sits behind a `WarmStore` interface with IndexedDB and in-memory adapters, so no new dependency is needed. Unit tests use the memory adapter; the real IndexedDB path is proven by e2e.

**D6 Change signals endpoint (ruling 4; revised r1, CR5).** `GET /api/dashboard-changes?ids=` is a top-level path, so it cannot collide with `/api/dashboards/:id/...` matchers.

- **Response.** Items are `{dashboardId, contentUpdatedAt, dataUpdatedAt, outputs: [{outputId, dataUpdatedAt}]}`, plus `serverNow`. `dataUpdatedAt` is the max over `outputs`, or null.
- **Queries.** Two read queries run on the caller's RLS context (`DbContext.withUserContext`), shaped to use the indexes:

```
-- content
SELECT d.id, GREATEST(d.last_updated, (SELECT MAX(p.last_updated) FROM panels p WHERE p.dashboard_id = d.id))
FROM dashboards d WHERE d.id = ANY(:ids);
-- data: one index probe per distinct bound Output
SELECT o.dashboard_id, o.output_id, h.captured_at
FROM (SELECT DISTINCT p.dashboard_id, p.output_id FROM panels p
      JOIN outputs ot ON ot.id = p.output_id          -- RLS outputs_select drops inaccessible Outputs first
      WHERE p.dashboard_id = ANY(:ids)) o
LEFT JOIN LATERAL (SELECT captured_at FROM output_snapshot_history
                   WHERE output_id = o.output_id ORDER BY captured_at DESC LIMIT 1) h ON true;
```

The second query first restricts to Outputs the caller can access. The RLS check on `outputs_select` is the same pipeline-access check, evaluated once per Output. It then probes the `(output_id, captured_at DESC)` index with LIMIT 1 for each surviving Output, whose newest row passes the identical history policy. History rows are therefore never scanned for an Output the caller cannot access (CR5, revised r2).

- **Visibility.** RLS on `dashboards`/`panels` (`helio_can_access_dashboard`) and `output_snapshot_history` (`helio_can_access_pipeline`) decides it. An inaccessible dashboard yields no row, so it is omitted with no 403/404 oracle. A dashboard-only grantee gets `dataUpdatedAt: null`, consistent with that grantee being unable to read the rows.
- **Done-check.** `EXPLAIN (ANALYZE, BUFFERS)` of both queries, on a dashboard of 12 Outputs each holding at least 500 history points (seeded in the dev DB by the executor, then removed by exact id), must show index scans on `output_snapshot_history` with one row per Output and an execution time under 20ms. The check must hold **both as the owner and as a dashboard-only grantee with no pipeline grant**, and in the grantee's plan there must be no per-history-row access-function evaluation. The plans and numbers are recorded in `measurements.md` and the PR.
- **Write-side change.** Panel delete bumps `dashboards.last_updated` in the same transaction, after the delete (create already bumps it). This keeps the panels-then-dashboards lock order, and V127's layout-version trigger does not fire on a `last_updated`-only update. Layout repair still does not bump, so HEL-1233's "a repair is not an edit" stands.
- **Known gap.** Cascade panel removals (Output, pipeline or source delete) still do not bump `last_updated` (V122, deliberate). A warm copy can then hold a panel that no longer exists. It is invalidated when the client itself performs such a delete (the Output/pipeline/source delete thunks call `dropWarmForOutputs`). A collaborator's delete shows as that panel's rows request failing until the TTL ends, which is stated as a known gap.
- **Alternatives rejected.** `pipelines.last_run_at` is set on failed runs too and is owner-scoped. `pipeline_runs` keeps only 10 runs and has no rows for grantee-triggered runs.

**D7 Changed dot and clocks (revised r1, CR1).**

- **Change signals.** `changeSignals` holds the D6 items plus `serverOffsetMs = serverNow - Date.now()`, measured when each response arrives.
- **Refresh triggers.** The signals refresh on hydrate, on any tab addition (new ids only), on `visibilitychange`→visible, and every 2 minutes while visible. These only ever hit the changes endpoint, never a panel or row request.
- **When the dot shows.** An inactive tab shows the dot when `contentUpdatedAt > max(lastViewedAt, ownWriteAt)` **or** `dataUpdatedAt > lastViewedAt`. Own writes never mask data (revised r2). A null `lastViewedAt` means no dot.
- **Last-viewed stamps.** `lastViewedAt` is stamped in server time on activation, on leave, and on hidden/pagehide for the active tab. The while-open heartbeat advances only the browser copy's stamp (D5), never the server pref.
- **Own edits.** An edit that is flushed after leaving (layout unmount flush, panel unmount flush) sets `ownWriteAt` from its own success response, so it never marks.
- **Accepted trade-offs.**
  - A collaborator's content edit landing between your leave and your own flush ack, one round trip plus the 2s `ownWriteAt` slack, is masked.
  - `serverOffsetMs` carries up to one RTT of error, so a collaborator write committed within about one RTT of a capture can be judged as captured.
  - Both windows are narrow, and the next change or the TTL corrects them.
- **Dot colour.** The board paints the dot in the sample accent. DESIGN.md §0 limits the accent to primary, selection, active indicators and focus, and a changed marker is none of these. The executor picks the existing info/attention intent token and records it under "UI decisions taken".
- **Accessible name.** The tab's name gets ", changed since you last viewed".

**D8 Tab bar layout.** Rendered only on the rail shell (`!useIsPhoneShell()`) on the dashboard view (`isDashboardViewPath`), as the first row of the content column above the `CommandBar`.

- Layout: the tablist, the "+" button, flexible space, then the ⌘K box at the right.
- Implementation: a new row in `.app-shell`'s grid (`auto auto minmax(0,1fr)`, rail and list spanning all rows), or a wrapper. The executor chooses whichever leaves the phone override and `ContextList` span correct, verified at 1280/820/768/375 in both themes.
- Active tab: `box-shadow: inset 0 2px 0 var(--app-accent)` (or an equivalent top border). Inactive tabs are muted text; the active tab is `--app-surface`-style raised. Tokens only, every accent preset.
- **Close control (revised r1, CR6).** Each tab sits in a `role="presentation"` wrapper inside the tablist.
  - The wrapper holds the `role="tab"` button and, as a **sibling** (never a descendant of the tab), a close button.
  - The close button has `aria-hidden="true"`, `tabIndex={-1}` and `title="Close <name>"`: it is a pointer affordance only.
  - Keyboard and AT close goes through Delete/Backspace on the focused tab. The tab advertises it with `aria-keyshortcuts="Delete"` and an `aria-describedby` hint, "Press Delete to close".
  - This keeps the tablist's owned elements to tabs only.
  - Known limit, stated in the PR: a touch-only assistive-technology user on a tablet (strip above 768px) has no close path. This is acceptable per the APG deletable-tabs pattern.
  - Tests assert:
    - the tab's accessible name contains no "Close";
    - the close button is found by title;
    - keyboard Delete closes the tab.
- Min tap height follows §3 control metrics.
- Drag uses native HTML5 drag (precedent `StepCardHeader`), with a 2px drop indicator.
- The `CommandBar`'s dashboard-name breadcrumb is hidden on the rail-shell dashboard view (the tab carries identity; "no dashboard title" ruling). The sr-only `<h1>` stays. Everything else on the `CommandBar` stays until HEL-1576.

**D9 ⌘K box.** A reusable `PaletteSearchBox` button showing a search icon, the text "Search, jump, or ask", and a `<kbd>` from `formatCombo` of the `command-palette` shortcut declaration (⌘K or Ctrl+K). It has `aria-keyshortcuts` and opens `useCommandPalette().open()`. Below a container width where the text no longer fits, it collapses to the icon plus kbd, keeping its accessible name. No new global shortcut is added (shortcuts.ts is unchanged).

**D10 Ask action (ruling 3).**

- `useAskAssistantAction()` reads `useCommandQuery()` (not debounced). For a non-blank trimmed query it returns one action: `{id: "ask.assistant", section: "Ask", matchesQuery: true, title: 'Ask the assistant: "<query>"'}`. `"Ask"` is appended last to `SECTION_DISPLAY_ORDER`.
- Its `run` navigates to `/chat` with state `{draft: query, autoSend: true}`.
- The send path moves out of `MessageComposer.handleSubmit` into a shared thunk, `startConversationWithMessage({message, idempotencyKey})` (create → `conversationCreated` → select → `converse`). Both the composer's null-id path and the handoff call it.
- `ChatPage` captures `autoSend` once, then clears router state (existing pattern). A ref guard makes React StrictMode's double effect send once, and the idempotency key is generated once per handoff.
- A free-tier user gets the existing request-access state, with no send. Converse errors (`CHAT_LIMIT_REACHED`, `TIER_FORBIDDEN`) surface through the existing composer copy.

**D11 Palette "open in a new tab" mode.** `CommandPaletteProvider.open(options?)` gains `{intent: "open-tab"}`. In that mode:

- the placeholder is "Open a dashboard in a new tab";
- only dashboard results are shown, all dashboards (most recently updated first) when the query is empty, through the existing search with the kind filter;
- the registered actions, recents and the ask action are hidden;
- a result's `run` dispatches `openTabActivate(id)`, which adds the tab after the active one and activates it.

The intent resets on close.

**D12 Testing (constraint C5 and the AC).**

- Backend:
  - `UserPreferencesRoutesSpec` cases for `dashboardTabs`: accumulate with other keys, each 400 case, byte-identical isolation, invalid stored value read as unset.
  - A new `DashboardChangesRoutesSpec` on `TwoUserRlsApiFixture`, whose app pool is NOBYPASSRLS. It covers: owned, shared-grantee, other user's private (omitted), unknown id (omitted), 0/21 ids (400), 401, the panel-delete bump, the layout-repair non-bump, and per-Output `dataUpdatedAt` from seeded history rows. The EXPLAIN (ANALYZE, BUFFERS) done-check of D6 is recorded in `measurements.md`.
  - `AuthServiceSpec`/`ApiRoutesSpec` carry the new key on the auth responses.
- Frontend unit tests: the slice (D1/D3 semantics), warm validity and TTL (fake timers), "run while active, leave, return: warm" (per-window `capturedAt`), "own edit on A, leave, run on A, ack: dot shows" (split rule), the unmount panel-update flush with per-panel dashboard attribution, lazy restore never clobbering an existing window or loaded/in-flight list, the own-write table (every content-write path calls `noteOwnDashboardWrite`), `paginationHydrated` restamping generations after `seedOutputMeta`, `clearWarmState` cancelling pending writes and closing before delete, the `WarmStore` memory adapter (bounds, user isolation, allow-listed keys, clear), the restore ordering (changes before hydrate, baseline seeded), the ask action, the palette intent, and the tablist keyboard model.
- Playwright: `e2e/hel1575-dashboard-tabs.spec.ts`. Network-log assertions follow the `hel1392-remount-staleness` pattern; `page.clock` fast-forwards 16 minutes for expiry. It covers:
  - open, close, reorder by mouse and keyboard;
  - reload and a second browser context restore;
  - a `/dashboards/:id` deep link beats the saved active tab, with no panel request for another dashboard first;
  - deleting an open dashboard (active: neighbour rule; inactive: tab removed);
  - drag a panel, switch within 30s, return: no dot while inactive, and no panel-list or rows request on return;
  - edit a panel title, switch, return: no dot, warm;
  - drag a panel, switch, reload within the TTL: no dot, warm;
  - the same in a second browser context: no dot;
  - a run while a tab is active, then leave and return within the TTL: warm;
  - a warm switch with no `/api/dashboards/*/panels` or `/api/outputs/*/rows` request;
  - an expired tab refetches;
  - reload within TTL is warm;
  - logout clears IndexedDB;
  - ⌘K box, the ask handoff (one converse request);
  - the changed dot after a pipeline run.
- Measurement: a 12-output-panel dashboard, timing warm vs cold switch (tab click to every panel body rendered, no skeleton), median of 5. The numbers and the method go in the PR.

**Implementation amendments (orchestrator-approved after phase A, 2026-10-15).**

- **A1 (D7 last-viewed stamps).** `lastViewedAt` is stamped on **leave** and on hidden/pagehide for the active tab. Activation stamps it only when the tab has never been viewed. Stamping on every activation would overwrite the leave value the TTL check uses, and the spec's "the moment the user last activated or left the tab" is met by the leave stamp.
- **A2 (D1 hydration).** When the saved `activeId` is gone but other saved tabs survive, the most recently viewed surviving tab is selected. Auto-selection runs only when the user has no saved key, or when pruning empties the set. This avoids silently dropping the saved set.
- **A3 (D5 clearing).** `clearAuth` also calls `resetOutputFreshness()`, so the 401 sign-out path drops the previous user's output caches the way logout already did.

## Risks / Trade-offs

- [Warm data shown stale after a run while away] → the remount reconcile bumps the generation and the card refetches; after a reload, the seeded baseline plus the `dataUpdatedAt` guard. Tested by the "a run refreshes a warm panel" e2e.
- [IndexedDB holds user data on a shared machine] → per-user keys, deleted on logout and on a 401 sign-out, deleted on startup for other users, 15-minute TTL, at most 8 entries of at most 1 MiB. The owner chose this trade (ruling 1).
- [Panel edits by a collaborator during the TTL] → covered by `contentUpdatedAt` via `panels.last_updated` and the new delete bump. A change by another user to a panel's bound Output metadata alone does not bump content, but its run does bump data.
- [Panel delete now reorders the dashboards list (sorted by `last_updated`)] → consistent with panel create already doing so. Stated in the PR.
- [Cross-device last-write-wins on `dashboardTabs`] → accepted; tabs are restored on each sign-in.
- [Tab retention extends memory use] → bounded to 8 warm tabs and the existing per-panel 200-row windows.
- [`keepalive` fetch body limit, 64 KiB] → a 20-tab payload is about 2 KiB.

## Migration Plan

Additive. There is no schema migration: the new preference key is absent for existing users, which means no tabs, and the first selection creates one. Rollback: revert the frontend and backend; a stored `dashboardTabs` key is ignored by the old reader (it parses known keys only) and the old PATCH allow-list simply rejects it. The IndexedDB database is orphaned harmlessly and expires by TTL logic on redeploy.

## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD dae4bc4516791452ad5b3e27e871d39771bbd5a6 (the planning artifacts are untracked in the change dir). Spawn-cwd guard: READY.
This is a code-trace review. No source was modified and no test suites were run.

### What I verified (with evidence)

**Prior round items**

- **CR1 (D3 pre-lock deadlock): resolved.**
  - D3 now drops the pre-lock, and task 1.4 says "No change to `PanelRepository` delete methods".
  - Every path now locks in a single order: panel rows first, then dashboards by id.
  - The "same locking" interpretation is stated explicitly.
  - Task 3.8 now covers a bulk Output delete racing a FK-cascade delete.
  - The duplicate-vs-cascade deadlock is recorded under Risks as accepted, with a reason.
- **CR3 (ghost-only diff contradiction): resolved in the design.**
  - D5b now says: compare unfiltered, filter the sent breakpoints, and a ghost-only diff is still sent (filtered) as one idempotent PATCH, never an empty one.
  - `buildLayoutPatch` (layoutPatch.ts:25-29) compares per breakpoint, so this is coherent.
  - Task 3.9 still does not name the expected PATCH body, which CR3 asked for. See the non-blocking notes.
- **CR4 (`replaceContents`): resolved.** It is named in Context and covered by task 3.5.
- **Round-1 notes:**
  - `COALESCE` / `[]`: task 1.3 and the 3.2 "only panel" case.
  - D6's HEL-1457 wording is corrected.
  - V123 RLS wipe risk: listed under Risks and in task 3.7.
  - Shared dev DB: listed under Risks.
  - All of these are folded in.
- **CR2 (D5 inert in the post-delete state): NOT resolved.** The revision fixes only the snapshots that exist at delete time. See CR1 below.

**Ground truth for the new defect (live code, file:line)**

- After a UI delete, panels go `idle` with no refetch, and the grid stays mounted. Evidence: `panelThunks.ts` `deletePanel` dispatches `markDashboardPanelsStale`, `panelsSlice.ts:174-183` sets `status = "idle"`, and `PanelList.tsx:93-113` treats this as a TERMINAL state with no fetch coming. `DesktopPanelGrid.tsx:188` then passes `panelsLoaded: panelsStatus === "succeeded"`, which is false, so `useLayoutSave.ts:197` passes `resolved = null`. D5b's filter is therefore inert for the rest of the session, as D5 itself admits.
- D5 deliberately leaves the store's dashboard `layout` and the `useLayoutSave` baseline holding the ghost.
- Undo snapshots are taken from that store layout:
  - `handleDragStart` / `handleResizeStart` set `preInteractionLayoutRef = latestLayoutRef.current` (DesktopPanelGrid.tsx:270-273 and 290-293). That is the authored store layout (`useLayoutSave.ts:137`).
  - `applyTraversal` pushes `currentLayout = state.dashboards.items[...].layout` into `future` (undo) or `past` (redo) (layoutHistoryThunks.ts:29-31; layoutHistorySlice.ts:68, 84).
- A drag rewrites only the active breakpoint: `{ ...layout, [bp]: items }` (DesktopPanelGrid.tsx:336-340). The other three breakpoints keep the ghost.
- The server does not reject a ghost item. `LayoutPolicy.violations` (LayoutPolicy.scala:57-63) checks bounds and overlap of the changed breakpoints only, with no panel-existence check. A ghost sent in a PATCH is stored.

**Classification check (the orchestrator's specific question)**

- Stripping `past` / `future` / `applied` on `deletePanel.fulfilled` does not break the `useLayoutSave` traversal classification in the normal ordering:
  - `revision` is not bumped by the strip, so the next store change sees `revisionChanged = false` regardless of what `applied` holds.
  - A later undo or redo sets `applied` to the already-stripped target and writes that same object to the store, so `areDashboardLayoutsEqual(layout, applied)` still matches (useLayoutSave.ts:140-145).
  - A redo of a layout recorded before the delete (a `future` entry existing at delete time) is stripped and classified correctly.
- The defect is not in the classification. It is that ghost-bearing snapshots are created after the strip. See CR1.

**D4 (assuming it ships):** sound in shape (idempotent, separate migration, proven under a non-BYPASSRLS role), with one internal inconsistency. See CR2.

**V-number check:** V121 is the latest migration on origin/main (a29a7e5c) and on this branch. I found no `V122__` / `V123__` in sibling worktrees. There are no triggers on `dashboards` that the strip's UPDATE would fire (V36 only defines policies).

### Verdict: REFUTE

### Change Requests

1. **D5 still writes ghosts back after a UI delete, through history entries created after the delete.**

   D5a cleans only the snapshots that exist when `deletePanel.fulfilled` runs. The store layout still holds the ghost (by design). D5b is inert because panels stay `idle`. So any snapshot taken after the delete carries the ghost, and a later traversal PATCHes it back. I traced two sequences, neither covered by task 3.9.

   - **(a) Delete, then drag, save, then undo.**
     1. A and B are on the dashboard, and the store is L1. Delete B. The server strips B. The store is still L1 (ghost in all four breakpoints), and the past stack is stripped.
     2. Drag A on lg. The snapshot pushed is L1, ghost included. The drag rewrites lg only, and the flush sends `{lg}` without B.
     3. The response is adopted (store equals `sentLayout`, dashboardsSlice.ts:345-347). This re-baselines to the ghost-free server layout.
     4. Undo. Target is L1 and `applied` is L1, so this is classified as a traversal and is pending.
     5. `buildLayoutPatch(L1, ghostFreeBaseline, null)`: lg, md, sm and xs all differ (B is present), so all four are sent containing B.
     6. The server accepts them. **B is restored to every breakpoint.**
   - **(b) Undo, then redo, after a delete.**
     1. The past stack holds L0 (pre-delete). The store is L1, ghost included. Delete B. The strip turns past into [L0′].
     2. Undo. `future.unshift(currentLayout = L1-with-ghost)` (layoutHistorySlice.ts:68). Flush. The baseline becomes ghost-free.
     3. Redo. Target is L1 with the ghost. The flush sends breakpoints containing B. **The ghost is written back.**
     This is the "redo of a layout" interaction the orchestrator asked about. The redo is safe for `future` entries that exist at delete time, and unsafe for entries created by an undo after it.
   - **(c) No undo needed.** A PATCH response that is not adopted, because a newer local edit is in flight, still sets `persistedLayoutRef` to the ghost-free server layout (useLayoutSave.ts:204) while the store keeps ghost-bearing md/sm/xs by reference (dashboardsSlice.ts:349). The next flush sees those breakpoints as "changed" and sends them, ghost included. This contradicts D5's claim that "an unedited breakpoint is never sent".

   **Required:**
   - Make the client filter independent of `panelsLoaded` for ids the client **knows** are deleted. For example, record deleted panel ids per dashboard on `deletePanel.fulfilled` (in `layoutHistorySlice` or a small sibling), and always drop those ids from every breakpoint `buildLayoutPatch` sends, whether or not the panels are loaded.
   - This leaves the store and baseline untouched, so the `useLayoutSave` classification (classes 1-4) is unaffected. Filtering known-deleted ids needs no loaded panel list, so it cannot wipe live items, which is the reason `resolved` is null-gated.
   - Keep D5a (it makes undo targets clean) and D5b (for ghosts the client never saw).
   - Correct D5's sentence "an unedited breakpoint is never sent…".
   - Extend task 3.9 with sequences (a) and (b), both in the real `idle` / `staleDashboardId` state, each asserting the exact PATCH body. Each test must fail red against D5a+D5b alone, not only against unfixed code: that is what proves the new filter is load-bearing.

2. **D4 and Risks disagree on how V123 reads panels.**
   - D4 lets the executor choose "a `helio_privileged`-owned SECURITY DEFINER helper … **or** per-owner `set_config('app.current_user_id', …)` as V114 does".
   - The Risks section says "the repair must read panels with RLS off (helio_privileged)".
   - The per-owner `set_config` option reads panels through RLS (`panels_select`, V36:146). That is exactly the "RLS-filtered to empty, then wipes every item" failure the Risks bullet guards against.
   - A competent implementer can read this two ways, and the wrong reading is silently destructive on prod data.
   - **Required:** pick the RLS-off helper (re-owned with the D2 bracket, `row_security = off` so a lost re-own fails loudly with 42501), and delete the `set_config` alternative from D4.

### Non-blocking notes

- **Round-1 CR3 residual:** task 3.9 should name the expected PATCH body for the loaded-panels D5b case. For example, a ghost-only diff in md sends `{md: [live items, stored order]}`.
- **Ordering assumption to state in D5a:** stripping `applied` is safe only because `deletePanel.fulfilled` cannot land between `applyTraversal`'s store write and `useLayoutSave`'s effect for that write. If it did, the store (ghost) would no longer equal the stripped `applied`, the undo would be re-baselined as persisted (class 4), and it would never be saved. With synchronous dispatch and discrete-event effect flushing this is very unlikely, but a one-line note (or stripping `applied` only when it is not the current store layout) would close it.
- **D5b scope:** the filter's "first entry per id" dedupe is a small behaviour change beyond ghost removal. It is harmless, but mention it in the spec delta or drop it.
- **V123 timestamp:** V123 should state whether it touches `last_updated`. D1 says the trigger does not. The repair should match, or state otherwise.
- **Shared-machine constraint:** task 3.12 still mentions `sbt testFull` / full jest. Per the lane constraints, keep those behind the MemAvailable check and `nice -n 19` as written.

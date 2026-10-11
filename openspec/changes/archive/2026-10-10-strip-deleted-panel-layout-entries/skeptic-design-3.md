## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD `dae4bc4516791452ad5b3e27e871d39771bbd5a6`. The change dir is untracked, so there is no code diff yet; I reviewed the artifacts against the live code.

### What I verified (with evidence)

**Owner rulings**
- `.concertino/runs/HEL-1456/events.jsonl` line 8 holds `escalation.answered`: `sub_answers ["approve-v123","server-filter"]`, `answer_source: human`, `resolution_channel: chat`.
- That event answers the Q1/Q2 escalation raised at line 7.
- Its timestamp, 1791695200883, is 2026-10-11 UTC, which matches the "2026-10-11" in D4/D5.
- The rulings are genuine.

**Round-2 CR2 (how V123 reads panels): closed**
- D4 now mandates only the `helio_privileged` SECURITY DEFINER helper with `row_security = off`, using the D2 bracket.
- The V114 `set_config` alternative is explicitly rejected.
- C1 and task 1.5/3.7 match. The "prod counts unmeasured" disclosure is required in the V123 header and in the PR body.

**Round-2 CR1 (client ghost write-back via undo/redo or a stale baseline): closed for the client sequences, with one gap (CR1 below)**
- `DashboardService.update` (DashboardService.scala:183-208) routes both the owner and editor branches through `DashboardWrites.applyUpdate` (DashboardWrites.scala:36-58).
- So a filter there covers every PATCH from web, MCP and stale tabs. It also covers `PatchSetApplyForward:44`, `DashboardProposalService.applyLayout:183`, and the two `RestorePriorStored` callers (`PatchSetUndoService:190`, `PatchSetApplyRollback:104`).
- Round-2 sequences (a), (b) and (c) all reach the server as a PATCH body containing B. A server-side drop of B therefore closes all three, whatever state the client is in.

**Client PATCH-response adoption: no pending flag left stuck, no loop**
- `updateDashboardLayout.fulfilled` (dashboardsSlice.ts:337-351) adopts the response when `store == sentLayout`. It does not compare the response with `sentLayout`, so a ghost-free response to a ghost-bearing send is adopted.
- After adoption, the `useLayoutSave` effect re-baselines (useLayoutSave.ts:156-163), and `.then` sets `persistedLayoutRef` to the response (useLayoutSave.ts:204).
- Non-adopted branch (a newer edit is in flight):
  - The store keeps the ghost and the baseline is ghost-free, so the next flush sends the ghost-only-different breakpoints once more.
  - The server filters them, and the response is adopted on that round.
- Bounded at one extra PATCH. No loop.

**"No new 400 on a previously-valid write"**
- `LayoutValidator.Violation` has only `Overlap` and `OutOfBounds` (LayoutValidator.scala:18-21). Removing items cannot create either, so a subset of a valid breakpoint is valid. Confirmed.
- The stored-bad + ghost edge D5 names is real: `sameItems` pass-through (LayoutPolicy.scala:52-63) compares the filtered patch with the *unfiltered* stored value. See CR1 for the fix that removes this edge entirely.

**Task 1.7 write paths**
- Duplicate (DashboardSnapshotRepository.scala:34-35) and import (`:140-145`) remap ids with `flatMap`, so unknown ids are already dropped. Safe.
- Owner repair rejects unknown ids (DashboardLayoutRepair.scala:6-14, `check`) and is compare-and-set (`DashboardLayoutRepairWrite:39`). Safe.
- `DashboardContentsOps:60` builds its layout from new panel ids. Safe.
- `AutoLayoutService.applyAutoLayout` (AutoLayoutService.scala:84-120) bypasses `DashboardWrites`:
  - It writes the full layout via `dashboardRepo.update`, keeping `kept` items from an unlocked `existing` read.
  - After V122/V123 it can only carry a ghost through the HEL-1457-class stale read.
  - Task 1.7 should record this explicitly (see notes).

**Panel-id lookup for D5**
- `DashboardRepository.panelIdsInternal` (DashboardRepository.scala:181-184) is unpaged and runs on the privileged (BYPASSRLS) pool (DbContext.scala:63-64).
- This is the correct lookup. The design never names it (see notes).

**HEL-1457 claim (D6)**: contradicts D5 and task 1.6 (CR1).

**Undo after a panel delete: new regression found (CR2)**
- `PatchSetUndoConflictCheck.checkDashboard` (PatchSetUndoConflictCheck.scala:123) requires `live.layout == journaled.layout`.
- `ResolvedAction.DashboardUpdate.prior` is resolved before any edit applies: `PatchSetApplyService.apply:76` resolves all edits, then `applyResolved`; `PatchSetApplyResolvers:124`.
- Patch-set edits apply in caller order (`PatchSetApplyService:40`).

### Verdict: REFUTE

### Change Requests

1. **D5 and task 1.6 filter only the *supplied* breakpoints, but D6's HEL-1457 claim depends on filtering the *merged* layout. The two contradict each other, and the D6 claim is false as tasked.**
   - `DashboardWrites.applyUpdate` merges the patch into `existing`, an unlocked read made earlier by `DashboardService.update:193`. `dashboardRepo.update` (DashboardRepository.scala:164-175) then writes all four breakpoints.
   - Suppose a panel delete (V122 strip) commits between that read and the D5 panel-id read. A supplied-only filter writes the deleted panel's item back into every breakpoint the client did *not* send.
   - D6 says "the merged layout is filtered to live panels before the write". D5 says "each supplied breakpoint of the patch is filtered", and task 1.6 says "filter each supplied breakpoint".
   - **Required:**
     - Specify the filter as: filter `existing.layout` (all four breakpoints) *and* the patch to the live panel-id set, then run `LayoutPolicy` / `applyUnvalidated` against the filtered existing.
     - This makes D6 true. The only remaining window is a delete that commits between the panel-id read and the UPDATE.
     - It also removes D5's stored-bad + ghost edge, because `sameItems` compares ghost-free against ghost-free. The fix then no longer depends on V123 having run, or on no race ever re-storing a ghost.
     - Update D5, D6 and task 1.6 to match.
     - Add a test that calls `applyUpdate` with a stale `existing` holding a ghost in a breakpoint the patch does not supply. It must assert that no breakpoint is stored with the ghost, and it must be RED against a supplied-only filter.

2. **V122 makes patch-set undo refuse a patch set that edits a dashboard and then deletes a panel on it. This is a new user-visible regression that the design does not mention.**
   - Example: `[dashboard update D (any field, even just a rename), panel delete P on D]`.
   - The journaled `resultingState` of the D update holds P's layout items.
   - Next, the panel-delete edit fires the trigger, which strips P from `D.layout`.
   - At undo, `checkDashboard` (PatchSetUndoConflictCheck.scala:123) sees `live.layout != journaled.layout` and reports "dashboard D was changed since the patch set was applied".
   - Undo is all-or-nothing (`PatchSetUndoService:71`), so the whole undo is refused.
   - Pre-fix, the delete never touched D's row, so the same undo succeeds.
   - Likewise, any later panel delete on D (UI, cascade) now blocks undo of an earlier patch-set edit to D. That is arguably a legitimate conflict, but it is still a behaviour change.
   - Mitigating context: `[dashboard update D, panel create on D]` already refuses today, because create appends to the layout. The class exists, but this change widens it.
   - **Required:**
     - D1/D6 (or a new decision) must name this interaction, state the chosen handling, and add a test that pins it.
     - Possible handling: accept it and document it, with a follow-up ticket. Alternatively, ignore deleted-panel items in the conflict comparison.
     - The second option touches a patch-set file, which this plan reserves for the HEL-1482 lane. Choosing it is a scope/lane decision for the orchestrator or owner, not the executor.
     - Do not leave the interaction unstated.

3. **Task 3.9a does not specify a reachable sequence. As written, it can pass vacuously.**
   - After V122, "patch-set apply D update, then user deletes P, then undo" is refused by the conflict check in CR2, so the code never reaches `RestorePriorStored`.
   - The reachable undo path is `[panel delete P on D, dashboard update D]` in one patch set:
     - `prior` for D is resolved before the delete, so it contains P.
     - The journaled resulting layout and the live layout are equal, so undo proceeds and restores the pre-delete layout.
   - The rollback path is the same pair followed by a failing edit (`PatchSetApplyRollback:103-104`).
   - **Required:** name these two sequences in task 3.9a. Each test must assert that the undo/rollback outcome status is `restored` / `rolledBack` (proving `RestorePriorStored` actually ran), and that the stored layout holds no item for P.

### Non-blocking notes
- Name the lookup in D5: `DashboardRepository.panelIdsInternal`, which is unpaged and privileged.
  - Do not use `PanelRepository.findAllByDashboardId`. It is paged; `AutoLayoutService` caps it at `Page.MaxLimit` = 500. Live panels beyond the page would be filtered out of the layout.
  - The lookup must never be RLS-scoped: panels that an editor created on the owner's dashboard must survive the owner's PATCH.
  - A test with a non-owner-created panel on the dashboard would pin this.
- Task 1.7: record that AutoLayout's full-layout write from an unlocked read is the same HEL-1457-class window. Either route it through the same filter or state it as residual. Duplicate, import, repair and contents-replace are already safe (cited above).
- A behaviour change worth one line in the spec delta: a patch-set or MCP layout that names an id *not on the dashboard* (for example, a hallucinated id) is now silently dropped instead of stored.
- Seam test 3.10: also assert that the fulfilled reducer adopts the response (`hasPendingLayout` false), not just that the response contains no ghost.

## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 71e2802bbc1acb3b59c60291c6f16431fb404165 (main; the change dir is untracked planning output only).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/subtype-save-keeps-staged-edits/HEL-1828`.
- **Replacer inventory (design.md Context)**: I read `frontend/src/features/panels/state/panelsSlice.ts` in full through l.420.
  The line numbers match exactly: `accumulatePanelUpdate` at l.125 with the HEL-1615 shallow merge (l.137-155).
  Whole-panel replacers are at l.302/307/331/336/341/346/351/356, and `updatePanelsBatch` is at l.361 (id map).
  `updateDashboardLayout.fulfilled` (HEL-1657 `lastSavedAt`) is at l.365.
  I grepped `frontend/src` for `action.payload.id|updatedById|panelsRestored(`. No other slice replaces a panel item:
  the `dashboardsSlice` and `outputsSlice` hits are about other entities. `panelsRestored`, `fetchPanels`,
  `duplicateDashboard` and `importDashboard` are list loads, and the plan declares them non-goals. The inventory is
  complete for single-panel saves.
- **Flush semantics (Decision 3 premise)**: `usePanelUpdatesFlush.ts:90-101` sends a `pending` snapshot from a ref
  and dispatches `clearSentPendingPanelUpdates(pending)` only inside `.unwrap().then` of `updatePanelsBatch`. So when
  the batch `fulfilled` reducer runs, `pendingPanelUpdates` still holds the sent entry, as the design claims.
  `clearSent` (l.164-170) compares with JSON.stringify and deletes the entry. Because the reducers never write
  `pendingPanelUpdates`, nothing is sent twice. The exactly-once claim holds.
- **Modal flow**: `PanelDetailModal.tsx:144-188` stages title and the changed appearance keys through
  `accumulatePanelUpdate`, then awaits `activeEditorRef().current.save()`. `OutputControlsEditor` is mounted with
  `controlsEditorRef` for output panels (l.311). `updatePanelOutputControls` is dispatched only from
  `OutputControlsEditor.tsx` (grep). This confirms the defect path.
- **Callers that stage edits**: only `PanelDetailModal.tsx:163` (title plus background/color/transparency) and
  `usePanelTitleEditing.ts:37` (trimmed title). Neither stages `chart`, `null` or `type`. So Decision 4's overlay
  keys and the shallow merge cover every real staged shape.
- **Server normalization vs Decision 3 overlay**: the batch path (`PanelBatchWrites.updateValidated` →
  `PanelMutationRepository.batchUpdate` l.99-116) writes `title` untrimmed and applies `PanelAppearance.applyPatch`.
  For non-null scalar keys that is a straight replace. So the batch response equals the overlaid pending values for
  every shape staged today. Re-applying them in the batch `fulfilled` case changes nothing on screen.
- **Spec delta**: `openspec/specs/panel-write-accumulator/spec.md` exists. The ADDED requirement does not conflict
  with its four existing requirements. Its four scenarios each map to a task (2.1/2.2).
- **AC coverage**: AC1 (a test that fails first, title shown throughout) is covered by tasks 2.2 and 2.3 (red output
  committed before implementation). AC2 (nothing lost or double-sent) is covered by 2.2 (batch carries the title
  once, the controls request carries none) and Decision 2. The HEL-1657/HEL-1634 non-regression is covered by 3.3
  and 4.2. No placeholders, no TBDs, and no backend, schema or API change, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

1. **design.md Risks, bullet 2 is factually wrong.** It says "the batch response still wins after `clearSent`
   removes the entry". Nothing re-applies the server copy after `clearSent`: it only deletes the pending entry. With
   Decision 3, the overlaid staged value stays in `items` until the next server copy of that panel arrives. Today
   this has no visible effect, because the batch response equals the staged values (see the normalization check
   above). It becomes a real divergence if a future stager sends `null` (server resets to the default), a partial
   `chart` (server merges field by field), or anything else the server normalizes. Fix the wording. Optionally add
   a code comment at the batch case naming this assumption.
2. **The modal test must read the panel from the store.** `PanelDetailModal` takes `panel` as a prop
   (`PanelDetailModal.tsx:46`), so a test that renders it with a fixed prop object can never see the revert and
   would pass before the fix. The test harness must pass the store's current panel (for example a wrapper that
   selects it by id, the way `DesktopPanelGrid.tsx:260` does), or assert on store state. Task 2.3's committed red
   output is what proves this. The evaluator should check that file and confirm the modal test is actually red.
3. **Decision 1 wording.** For `accumulatePanelUpdate`'s local item, make clear whether the helper is applied
   with the increment (`fields`) or the merged pending entry. Both are correct, because the earlier staged values
   are already in the item. Pick one and say which.
4. `workflow-state.md` has `TICKET_TYPE: feature` for a bug ticket. This is cosmetic.

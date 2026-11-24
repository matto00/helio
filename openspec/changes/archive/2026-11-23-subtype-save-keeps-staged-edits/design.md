## Context

See proposal.md - Why. Current tree (main 71e2802bb), `frontend/src/features/panels/state/panelsSlice.ts`:

- `accumulatePanelUpdate` (l.125) merges staged `fields` into `pendingPanelUpdates[panelId]` and into the local item,
  with a SHALLOW appearance merge (HEL-1615).
- Whole-panel replacers (`panel.id === action.payload.id ? action.payload : panel`): `updatePanelAppearance` (l.302),
  `updatePanelTitle` (l.307), `updatePanelTextContent` (l.331), `updatePanelMarkdownContent` (l.336),
  `updatePanelImage` (l.341), `updatePanelDivider` (l.346), `updatePanelForm` (l.351), `updatePanelOutputControls`
  (l.356); and `updatePanelsBatch` (l.361, by id map). No other slice replaces a panel item (grep over
  `frontend/src` for `action.payload.id` / `updatedById`; `swapPanelOutput` has no slice case, only warm listeners).
- `PanelDetailModal.handleEditSubmit` stages title/appearance first, then awaits the active editor's `save()`
  (`OutputControlsEditor` dispatches `updatePanelOutputControls`). The flush (`usePanelUpdatesFlush`) sends a snapshot
  of `pendingPanelUpdates`, then `clearSentPendingPanelUpdates(snapshot)` AFTER the batch `fulfilled` reducer runs.

## Goals / Non-Goals

**Goals:** every inventoried replacer shows server copy + pending overlay; exactly-once flush unchanged.
**Non-Goals:** list loads (`fetchPanels`, `duplicateDashboard`, `importDashboard`); flush timing; server null/chart
merge semantics (see proposal Non-goals).

## Decisions

1. **One shared helper `withPendingOverlay(panel, pending)`** (module-private in panelsSlice.ts) returning
   `{...panel, ...pending, appearance: {...panel.appearance, ...pending.appearance}}` (appearance key only when the
   pending entry has one). `accumulatePanelUpdate` applies it to the local item with the INCREMENT (`fields`), as
   today (earlier staged values are already in the item), so staging and re-application share one merge.
   Alternative: copy the merge into each case -- rejected, eight copies drift.
2. **One shared replace helper `replacePanelFromServer(state, serverPanel)`** used by all eight single-panel cases:
   item = `withPendingOverlay(serverPanel, state.pendingPanelUpdates[serverPanel.id])`, or the server copy verbatim
   when nothing is pending. The reducers never read-modify `pendingPanelUpdates`, so the flush still sends each
   staged field exactly once (the subtype request body is built from the editor's own state, never from pending).
3. **The batch `fulfilled` case overlays too.** At that moment `pendingPanelUpdates` still holds the sent snapshot
   (clear happens after), so overlaying it on a server copy that already applied it is idempotent for the sent
   fields; an edit staged on that panel DURING the round trip (HEL-1575 4.5(5) keeps it pending) is now also kept on
   screen instead of reverting. Same defect class as the ticket; included so the inventory has no exempt replacer.
   `lastSavedAt`/`panelSaveSeq` (HEL-1657/1584) unchanged.
4. **Overlay keys are exactly `PanelUpdateFields`** (title, appearance, type -- whatever was staged), never config,
   so a subtype save's server config is never masked.
5. **Inventory evidence**: the grep command and its output are committed as
   `openspec/changes/subtype-save-keeps-staged-edits/replacer-inventory.txt` (and persisted to the run evidence).

## Risks / Trade-offs

- [A pending `type` staged and a subtype server copy of a different type] -> `PanelUpdateFields` type staging is the
  pre-existing accumulate behavior; overlay matches what accumulate already shows. No new mismatch.
- [Server normalises a staged value differently from the client mirror] -> after `clearSent` deletes the entry the
  overlaid staged value stays in `items` until the next server copy of that panel. Today every staged shape (title,
  scalar appearance keys) is stored verbatim, so nothing differs; a future stager sending `null` or a partial `chart`
  would diverge. A code comment at the batch case names this assumption.
- [HEL-1634 sign-out reset] -> reset clears `pendingPanelUpdates`; with nothing pending the overlay is a no-op.

## Testing

- Red first (committed as .txt before implementation): (a) slice-level tests, one per inventoried replacer, staging a
  title + partial appearance then dispatching that thunk's `fulfilled` with a server copy lacking them; (b) modal-level
  jest test (`PanelDetailModal`, output-kind panel, mocked services) staging title + output-controls change, asserting
  the new title is shown after the controls save resolves, after the batch flush, and that the batch request carries
  the title exactly once and the controls request carries none. Mutation: revert one reducer -> its test goes red.
- Full spec files: panelsSlice*.test.ts, PanelDetailModal*.test.tsx, usePanelUpdatesFlush tests, warm listener tests.

## Planner Notes

- Self-approved: include `updatePanelsBatch.fulfilled` and the legacy title/appearance thunks (Decision 3); no e2e
  needed -- the defect is reducer state, and a jest modal test with the real store exercises the real modal save.

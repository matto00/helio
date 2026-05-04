## Context

`PanelDetailModal.tsx` already has a `modalMode` state (`"view" | "edit"`) and a per-tab save/cancel structure introduced in HEL-174 and HEL-175. Each tab (appearance, content, image, divider, data) has its own form and a footer Save button that submits only that tab's form. The appearance tab uses `accumulatePanelUpdate` (Redux accumulator, not a direct API call) while other tabs (content, image, divider, data) call async thunks that hit the API and close the modal on success.

The ticket asks for: no auto-save, Save commits all changes via API, Cancel/Esc with confirmation discards and returns to view mode (not close), and an unsaved-changes indicator in the header.

Key observation: the current flow _closes_ the modal after every save. The ticket explicitly says Cancel returns to **view mode**, not closes the modal. This means the save/cancel flow should transition between modes, not close the modal.

## Goals / Non-Goals

**Goals:**
- Save button in edit mode commits the active tab's changes via API and returns to view mode.
- Cancel button in edit mode discards staged changes and returns to view mode (with discard confirmation if dirty).
- Esc in edit mode triggers the cancel flow (same as clicking Cancel).
- Unsaved changes badge/indicator in the modal header when any field is dirty in edit mode.
- Appearance tab save uses the existing `PATCH /api/panels/:id` endpoint (via a new `updatePanelAppearance` thunk call, not just the accumulator).

**Non-Goals:**
- Changing behavior of close (✕) button — it retains current behavior (close with warning if dirty).
- Changing how view-mode close works.
- Auto-save timers, undo/redo.

## Decisions

### D1: Save returns to view mode, not close

Currently all saves close the modal. The ticket says Cancel/Esc "returns to view mode". By symmetry, Save should also return to view mode (not close), matching the spec requirement that the modal has a persistent view/edit duality. Implementation: replace `dialogRef.current?.close(); onCloseRef.current()` in save handlers with `setModalMode("view")`.

Alternative: keep closing on save. Rejected — the ticket explicitly says the Save/Cancel axis governs the edit-mode session, not the modal lifetime.

### D2: Appearance save goes through the API (not just accumulatePanelUpdate)

The current appearance save dispatches `accumulatePanelUpdate` (local Redux accumulator, deferred flush). The ticket says "Save button commits all changes via the API." We replace `accumulatePanelUpdate` with `updatePanelAppearance` thunk to hit the API immediately on Save. The accumulator is used for real-time layout drags on the grid — not for explicit modal saves.

### D3: Unsaved changes indicator is a header badge, not a separate component

The `isDirty` / `dataDirty` / `contentDirty` / `imageDirty` / `dividerDirty` flags already exist. A small "Unsaved changes" badge element is rendered in the header (inside `panel-detail-modal__header`) when `modalMode === "edit"` and any dirty flag is true. No new Redux state needed.

### D4: Cancel in edit mode returns to view mode (not close)

The existing `handleCancel` checks dirty flags and shows a discard warning. The discard confirmation currently calls `handleDiscard` which closes the modal. We update both:
- Clean cancel: `setModalMode("view")` and reset all local form state to initial values.
- Dirty cancel: show discard warning; on confirm, reset state and return to view mode.

This requires a `resetToInitial()` helper that restores all form state fields from `panel` props.

### D5: Esc in edit mode = Cancel (already working via the `cancel` event handler)

The existing `handleCancel` event handler already intercepts the `cancel` event (which fires on Esc). It will now call the updated logic that returns to view mode instead of closing.

## Risks / Trade-offs

- [Risk] `initialBackground`, `initialColor`, etc. are computed once at mount time (from `panel` props). If the panel prop updates while the modal is open (e.g. after a successful save), initial values become stale on the next edit entry. Mitigation: on each `setModalMode("edit")`, snapshot the current `panel` prop values into local state as the new baseline. This is a ref-based reset.
- [Risk] `accumulatePanelUpdate` is currently the appearance save path; tests mock `updatePanelAppearanceRequest` from `panelService`. Switching to the API thunk aligns with the existing test structure — tests already mock `updatePanelAppearanceRequest`.

## Planner Notes

- Self-approved: no new external dependencies, no backend changes, no breaking API changes.
- The `handleDiscard` function (closes modal) stays for the ✕ close button path; only edit-mode Cancel/Esc is updated.
- Tests need updating: current "save appearance" tests assert `accumulatePanelUpdate` dispatch; they should now assert `updatePanelAppearance` API call and that the modal remains open (view mode).

## Why

Edit mode in the panel detail modal currently has no explicit commit/discard mechanism — users have no clear way to save their changes or abandon them. This creates confusion about when changes persist and risks accidental data loss or unintended saves.

## What Changes

- **Remove auto-save behavior** from edit mode in the panel detail modal; changes are staged locally until explicitly committed.
- **Add Save button** in the modal footer that submits all staged appearance/data changes via the API and returns to view mode on success.
- **Add Cancel button** in the modal footer that discards staged changes and returns to view mode, with a confirmation prompt if changes exist.
- **Escape key in edit mode** triggers the cancel flow (with confirmation if unsaved changes exist).
- **Unsaved changes indicator** shown in the modal header when the user has made edits that have not yet been saved.

## Capabilities

### New Capabilities

- `panel-edit-mode-save-cancel`: Save and Cancel controls in the panel detail modal's edit mode, with unsaved-changes tracking, explicit API commit on Save, and discard-with-confirmation on Cancel/Escape.

### Modified Capabilities

- `panel-detail-modal`: The modal's dismiss/escape/cancel behavior must now distinguish between view mode (immediate close) and edit mode (discard confirmation if dirty). The footer Save/Cancel button visibility is part of this spec.
- `panel-view-mode`: The edit mode exit path now goes through explicit Save or Cancel rather than auto-save; the Edit button that enters edit mode must be updated to reflect the new flow.

## Impact

- Frontend: `PanelDetailModal` component — edit mode state management, form dirty tracking, Save/Cancel handlers.
- Frontend: Redux `panelsSlice` — staged edits must be held locally until Save is clicked, not dispatched on field change.
- No backend API changes required (existing `PATCH /api/panels/:id` endpoint is used by Save).
- No breaking changes.

## Non-goals

- Auto-save on a timer within edit mode.
- Conflict resolution for concurrent edits.
- Undo/redo within a single edit mode session.

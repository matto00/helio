## 1. Frontend

- [x] 1.1 Replace `accumulatePanelUpdate` in `handleAppearanceSubmit` with `updatePanelAppearance` async thunk so appearance save hits the API
- [x] 1.2 Update all save handlers (appearance, content, image, divider, data) to call `setModalMode("view")` instead of `dialogRef.current?.close()` + `onCloseRef.current()` on success
- [x] 1.3 Add `resetFormToPanel()` helper that resets all local form state fields back to current `panel` prop values (background, color, transparency, chartAppearance, selectedTypeId, fieldMapping, refreshInterval, markdownContent, imageUrl, imageFit, dividerOrientation, dividerWeight, dividerColor)
- [x] 1.4 Update `handleCancel` so that when `modalMode === "edit"`: clean cancel calls `resetFormToPanel()` then `setModalMode("view")`; dirty cancel shows discard warning
- [x] 1.5 Update `handleDiscard` (confirm discard) to call `resetFormToPanel()` then `setModalMode("view")` instead of closing the dialog
- [x] 1.6 Update the `cancel` DOM event handler (Escape key path) to call the same cancel logic for edit mode — return to view mode, not close
- [x] 1.7 Add unsaved-changes badge element in the modal header: rendered when `modalMode === "edit"` and any dirty flag is true; use a `panel-detail-modal__unsaved-badge` class
- [x] 1.8 Add CSS for `.panel-detail-modal__unsaved-badge` (small muted label, inline with the title area)

## 2. Tests

- [x] 2.1 Update "save appearance" test: assert `updatePanelAppearance` API call is made and modal transitions to view mode (Edit button visible) instead of closing
- [x] 2.2 Add test: Save on content/image/divider/data tabs transitions to view mode and does not close the modal
- [x] 2.3 Update "Cancel with no changes" test: assert modal goes to view mode (Edit button visible), not closed
- [x] 2.4 Update "Cancel with unsaved changes" test: after confirming discard, assert modal is in view mode (not closed)
- [x] 2.5 Add test: Escape key in edit mode with no changes returns to view mode
- [x] 2.6 Add test: Escape key in edit mode with unsaved changes shows discard warning; confirming returns to view mode
- [x] 2.7 Add test: "Unsaved changes" indicator appears in header after modifying a field in edit mode
- [x] 2.8 Add test: "Unsaved changes" indicator not shown when no fields are changed in edit mode
- [x] 2.9 Add test: changing a field in edit mode does not dispatch any API call until Save is clicked

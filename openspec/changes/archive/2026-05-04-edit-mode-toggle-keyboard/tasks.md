## 1. Frontend

- [x] 1.1 Add `keydown` listener to the dialog element in `PanelDetailModal.tsx` that calls `setModalMode("edit")` when `E`/`e` is pressed while `modalModeRef.current === "view"` and the event target is not an input/textarea/select
- [x] 1.2 Ensure the listener is registered in a `useEffect` with proper cleanup (remove on unmount)

## 2. Tests

- [x] 2.1 Add test in `PanelDetailModal.test.tsx`: pressing `E` in view mode transitions to edit mode
- [x] 2.2 Add test: pressing `E` when focus is on an input element inside the modal does not change mode
- [x] 2.3 Verify existing tests for Esc-in-view-mode close and Esc-in-edit-mode-with-unsaved-changes discard confirmation still pass

## 1. Frontend

- [x] 1.1 Add `isDirty` derived state to `PanelCreationModal` (true when type, template, or title is set)
- [x] 1.2 Add `handleDismiss` helper that checks `isDirty` and calls `window.confirm()` before closing
- [x] 1.3 Wire `onCancel` on the `<dialog>` element to intercept native Escape and call `handleDismiss`
- [x] 1.4 Add `onClick` handler on the `<dialog>` element to detect backdrop clicks and call `handleDismiss`
- [x] 1.5 Update the close button `onClick` to call `handleDismiss` instead of `handleClose` directly
- [x] 1.6 Implement Tab/Shift+Tab focus-trap `keydown` handler inside the modal
- [x] 1.7 Attach the focus-trap handler to the `<dialog>` element and remove it on close

## 2. Tests

- [x] 2.1 Add test: Escape on clean modal closes without confirmation
- [x] 2.2 Add test: Escape on dirty modal (type selected) shows confirm and closes on accept
- [x] 2.3 Add test: Escape on dirty modal (type selected) shows confirm and stays open on cancel
- [x] 2.4 Add test: click outside on clean modal closes without confirmation
- [x] 2.5 Add test: click outside on dirty modal shows confirm and closes on accept
- [x] 2.6 Add test: close button on dirty modal shows confirm and closes on accept
- [x] 2.7 Add test: focus wraps forward from last to first focusable element on Tab
- [x] 2.8 Add test: focus wraps backward from first to last focusable element on Shift+Tab

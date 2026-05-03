## 1. Frontend

- [x] 1.1 Add `modalMode: "view" | "edit"` local state (default `"view"`) to `PanelDetailModal`
- [x] 1.2 Render view mode body: import `PanelContent` and display it filling the available modal height when `modalMode === "view"`
- [x] 1.3 Add "Edit" button to the modal header (visible only in view mode); clicking it sets `modalMode` to `"edit"`
- [x] 1.4 Hide tab bar and footer Save/Cancel buttons when `modalMode === "view"`
- [x] 1.5 Skip the discard warning on close when `modalMode === "view"` (no dirty state possible)
- [x] 1.6 Add CSS for view mode content area (`.panel-detail-modal__view-body`) to fill flex space

## 2. Tests

- [x] 2.1 Update existing test "renders the Appearance tab by default" to assert view mode renders first (no tab selected, Edit button visible)
- [x] 2.2 Add test: modal opens in view mode — tab bar not visible, Edit button visible
- [x] 2.3 Add test: clicking Edit button transitions to edit mode — Appearance tab becomes visible and selected
- [x] 2.4 Add test: close from view mode is immediate (no discard warning shown)
- [x] 2.5 Add test: close from edit mode with unsaved changes still shows discard warning

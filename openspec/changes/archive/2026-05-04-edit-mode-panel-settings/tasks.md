## 1. Frontend

- [x] 1.1 Remove the `Tab` type, `activeTab` state, and `handleTabChange` function from `PanelDetailModal.tsx`
- [x] 1.2 Remove the tab bar JSX (`panel-detail-modal__tabs` div and all tab buttons) from the edit mode render path
- [x] 1.3 Add `title` local state (pre-filled from `panel.title`) to the modal's state declarations
- [x] 1.4 Add a Title text input at the top of the Appearance section in the unified form
- [x] 1.5 Combine all edit-mode forms into a single `<form id="panel-detail-edit-form">` with section headings: Appearance, and the type-appropriate second section (Data / Content / Image / Divider)
- [x] 1.6 Update `isDirty` to include `title !== initialTitle` in its comparison
- [x] 1.7 Replace the per-tab save handlers with a single `handleEditSubmit` that dispatches appearance (including title), and then the type-appropriate second-section thunk if dirty
- [x] 1.8 Update the footer Save button to use `form="panel-detail-edit-form"` and show a unified saving state
- [x] 1.9 Update `PanelDetailModal.css` — add section heading styles, remove tab-related styles, ensure the edit form scrolls correctly within the modal body
- [x] 1.10 Update the `panel-view-mode` spec reference: verify the Edit button still works and transitions to the new unified form

## 2. Tests

- [x] 2.1 Update `PanelDetailModal.test.tsx` — remove tab-switching test cases; add tests that confirm all sections visible in edit mode without a tab bar
- [x] 2.2 Add test: title field is pre-filled and dispatches title update on save
- [x] 2.3 Add test: unified save dispatches appearance + data binding in sequence when both are dirty
- [x] 2.4 Add test: section-level inline error appears when data save fails and modal stays open
- [x] 2.5 Verify all existing passing tests still pass after the tab removal (`npm test`)

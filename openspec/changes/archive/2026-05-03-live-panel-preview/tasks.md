## 1. Frontend

- [x] 1.1 Add a `PanelCreationPreview` component that wraps `PanelContent` in a fixed-size panel card frame
- [x] 1.2 Accept `type: PanelType` and `title: string` props; show "Untitled" placeholder when title is empty
- [x] 1.3 Style the preview container with panel design tokens (border, background, border-radius, fixed height ~200 px)
- [x] 1.4 Display the title label above the `PanelContent` area inside the preview frame
- [x] 1.5 Update the `name-entry` step layout in `PanelCreationModal` to two columns (form | preview)
- [x] 1.6 Pass `selectedType` and `title` state to `PanelCreationPreview` from the modal
- [x] 1.7 Add responsive CSS: hide preview column and revert to single-column layout below 600 px
- [x] 1.8 Add `PanelCreationPreview` CSS to `PanelCreationModal.css` (or a dedicated CSS file)

## 2. Tests

- [x] 2.1 Test: preview renders the correct panel type on the name-entry step
- [x] 2.2 Test: preview title reflects the current title input value
- [x] 2.3 Test: preview shows "Untitled" placeholder when title input is empty
- [x] 2.4 Test: preview is not rendered on the type-select step

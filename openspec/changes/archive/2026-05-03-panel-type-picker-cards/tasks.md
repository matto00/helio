## 1. Frontend

- [x] 1.1 Add `description` field to each entry in the `PANEL_TYPES` constant in `PanelCreationModal.tsx`
- [x] 1.2 Update the type card JSX to render the description as a third element below the label
- [x] 1.3 Add `.panel-creation-modal__type-description` CSS class in `PanelCreationModal.css` (smaller font size, muted color)
- [x] 1.4 Add `:focus-visible` accent styling to `.panel-creation-modal__type-card` in CSS (accent border + surface highlight on focus)
- [x] 1.5 Widen modal `max-width` if needed and adjust grid column count to accommodate taller cards

## 2. Tests

- [x] 2.1 Update existing test "opens at the type-select step showing all 7 panel types" to also assert a description string is visible for at least one panel type
- [x] 2.2 Add test: each type card renders with a description (verify all 7 descriptions are present in the DOM)

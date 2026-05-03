## 1. Frontend — Constants

- [x] 1.1 Create `frontend/src/features/panels/panelTemplates.ts` with `PanelTemplate` interface and 2–3 templates per panel type (metric, chart, text, table, markdown, image, divider)
- [x] 1.2 Include a "Start blank" sentinel value or null-safe handling for the blank path

## 2. Frontend — Component

- [x] 2.1 Extend `Step` type in `PanelCreationModal.tsx` to add `"template-select"` between `"type-select"` and `"name-entry"`
- [x] 2.2 Update `handleTypeSelect` to advance to `"template-select"` instead of `"name-entry"`
- [x] 2.3 Add `handleTemplateSelect(template: PanelTemplate | null)` that pre-fills `title` (if template) and advances to `"name-entry"`
- [x] 2.4 Render the template-select grid step: cards for each template + "Start blank" card at end
- [x] 2.5 Add "Back" button on template-select step that returns to `"type-select"` and clears template state
- [x] 2.6 Update modal header title to reflect the new step (`"Choose a template"`)
- [x] 2.7 Ensure modal state reset (including template state) on close in all paths
- [x] 2.8 Add CSS for template-select grid and "Start blank" card (dashed border visual distinction)

## 3. Tests

- [x] 3.1 Update existing `PanelCreationModal.test.tsx` to account for the new template-select step in the flow
- [x] 3.2 Add test: selecting a template pre-fills the title input on name-entry step
- [x] 3.3 Add test: "Start blank" card leaves title input empty
- [x] 3.4 Add test: Back on template-select step returns to type-select
- [x] 3.5 Add test: modal resets template selection on close and reopen

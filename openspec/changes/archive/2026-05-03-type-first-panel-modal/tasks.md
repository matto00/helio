## 1. Frontend — PanelCreationModal component

- [x] 1.1 Create `frontend/src/components/PanelCreationModal.tsx` with `"type-select" | "name-entry"` step state and `<dialog>` using `dialogRef.current?.showModal()`
- [x] 1.2 Implement step 1: type picker grid with all 7 panel types as selectable cards (metric, chart, text, table, markdown, image, divider); no type pre-selected
- [x] 1.3 Implement step 2: title input, "Create panel" submit button, back button to return to type picker
- [x] 1.4 Wire `onClose` prop to close the dialog and unmount (matching `AddSourceModal` pattern)
- [x] 1.5 Dispatch `createPanel` thunk with selected type and title on submit; show inline error on failure; close modal on success
- [x] 1.6 Create `frontend/src/components/PanelCreationModal.css` with modal, type card grid, and step styles

## 2. Frontend — PanelList integration

- [x] 2.1 Remove inline `isCreateMode` form, `isCreateMode` state, `title` state, `panelType` state, `isCreating` state, `createError` state, and `PANEL_TYPES` constant from `PanelList.tsx`
- [x] 2.2 Add `isModalOpen` state and `useOverlay`-driven open/close to `PanelList`; render `{isModalOpen && <PanelCreationModal ... />}` conditionally
- [x] 2.3 Update "Add panel" header button to call `open()` / toggle modal instead of `setIsCreateMode`
- [x] 2.4 Update empty-state "Add panel" CTA to open the modal
- [x] 2.5 Import and render `PanelCreationModal` in `PanelList`

## 3. Tests

- [x] 3.1 Add unit tests for `PanelCreationModal`: modal opens at type-select step, type selection advances to name-entry step, back button returns to type-select, submit dispatches `createPanel` with correct type, error shown on failure, modal closes on success
- [x] 3.2 Update `PanelList.test.tsx`: remove inline create form assertions; add assertions that clicking "Add panel" opens the modal

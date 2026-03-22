## 1. PanelDetailModal Component

- [x] 1.1 Create `frontend/src/components/PanelDetailModal.tsx` — `<dialog>`-based modal with header (panel title + close button), tab bar (Appearance / Data), tab content area, and footer (Cancel / Save)
- [x] 1.2 Implement tab switching with local `activeTab` state (`"appearance" | "data"`)
- [x] 1.3 Implement Appearance tab — migrate background color, text color, and transparency controls from `PanelAppearanceEditor`
- [x] 1.4 Implement Data tab — placeholder message "Connect a data source to display real content"
- [x] 1.5 Wire Save to `updatePanelAppearance` thunk; close on success; show inline error on failure
- [x] 1.6 Implement dirty check — compare current form values to `panel.appearance`; show inline discard warning on dismiss attempt when dirty
- [x] 1.7 Handle Escape via `<dialog>` `cancel` event (`preventDefault` then run dirty-check logic)
- [x] 1.8 Handle backdrop click via `click` event on `<dialog>` element (click target === dialog = backdrop)

## 2. Styles

- [x] 2.1 Create `frontend/src/components/PanelDetailModal.css` — modal layout (header, tab bar, content, footer), tab active states, discard warning, responsive sizing

## 3. Wire into PanelGrid

- [x] 3.1 Rename `customizePanelId` state to `detailPanelId` in `PanelGrid`
- [x] 3.2 Replace the inline `PanelAppearanceEditor` render with `<PanelDetailModal>` rendered outside the grid (after the `<Responsive>` block, as a sibling)
- [x] 3.3 Update the "Customize" `ActionsMenu` item `onClick` to set `detailPanelId`

## 4. Remove Old Popover

- [x] 4.1 Delete `frontend/src/components/PanelAppearanceEditor.tsx`
- [x] 4.2 Delete `frontend/src/components/PanelAppearanceEditor.css`
- [x] 4.3 Remove all imports of `PanelAppearanceEditor` from the codebase

## 5. Tests

- [x] 5.1 Create `frontend/src/components/PanelDetailModal.test.tsx` — modal opens from Customize action, tabs switch, Data tab shows placeholder, Save calls thunk, Cancel closes without saving
- [x] 5.2 Update `App.test.tsx` and any other tests that reference `PanelAppearanceEditor` or `customizePanelId`

## 6. Verification

- [x] 6.1 Run `npm run lint` — zero warnings
- [x] 6.2 Run `npm run format:check` — clean
- [x] 6.3 Run `npm test` — all tests pass
- [x] 6.4 Run `npm run build` in `frontend/` — clean build

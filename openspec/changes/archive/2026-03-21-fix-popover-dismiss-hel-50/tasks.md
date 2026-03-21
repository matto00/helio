## 1. OverlayProvider

- [x] 1.1 Create `frontend/src/components/OverlayProvider.tsx` with `activeId` context, `openOverlay`, `closeOverlay`, and global Escape key listener
- [x] 1.2 Wrap `<App />` with `<OverlayProvider>` in `frontend/src/main.tsx`

## 2. ActionsMenu

- [x] 2.1 Update `ActionsMenu` to use `useId()` and `useOverlay` context — replace local `isOpen` state with context-driven open/close

## 3. DashboardAppearanceEditor

- [x] 3.1 Update `DashboardAppearanceEditor` to use `useId()` and `useOverlay` context — replace local `isOpen` state with context-driven open/close

## 4. PanelAppearanceEditor

- [x] 4.1 Update uncontrolled mode of `PanelAppearanceEditor` to use `useOverlay` context
- [x] 4.2 Add Escape key `useEffect` listener to controlled mode (`isOpenExternal === true`) that calls `onClose?.()`

## 5. Verification

- [x] 5.1 Run `npm run lint` and `npm run format:check` in `frontend/`
- [x] 5.2 Run `npm test` — ensure existing tests pass
- [x] 5.3 Run `npm run build` in `frontend/`
- [x] 5.4 Use Playwright to verify: Escape closes ActionsMenu, Escape closes DashboardAppearanceEditor, opening one menu closes another, click-outside still works

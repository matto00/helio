## 1. Redux — Layout History Slice

- [x] 1.1 Create `frontend/src/features/layout/layoutHistorySlice.ts` with state shape `Record<dashboardId, { past: DashboardLayout[]; future: DashboardLayout[] }>` and reducers: `pushLayoutSnapshot`, `undoLayout`, `redoLayout`
- [x] 1.2 Add selectors `selectCanUndo(dashboardId)` and `selectCanRedo(dashboardId)` to the slice
- [x] 1.3 Register `layoutHistoryReducer` in the Redux store (`store.ts`)

## 2. Redux — Local Layout Setter

- [x] 2.1 Add `setDashboardLayoutLocally` synchronous reducer to `dashboardsSlice` that updates `items[].layout` without triggering any async thunk

## 3. PanelGrid — History Commit

- [x] 3.1 Add `onDragStop` and `onResizeStop` props to the `<Responsive>` component in `PanelGrid`; in each handler dispatch `pushLayoutSnapshot` with the layout from `latestLayoutRef.current`

## 4. Keyboard Shortcut Hook

- [x] 4.1 Create `frontend/src/hooks/useLayoutUndoRedo.ts` — attaches a `keydown` listener that dispatches `undoLayout` / `redoLayout` (then `setDashboardLayoutLocally`) on `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z`, skipping dispatch when focus is in an editable element
- [x] 4.2 Mount the hook in the dashboard view component (e.g. inside `App.tsx` or the relevant dashboard route component), passing the active `dashboardId`

## 5. Toolbar Buttons

- [x] 5.1 Add undo and redo buttons to `app-header__controls` in `App.tsx`, visible only when `onDashboardView` is true
- [x] 5.2 Wire undo button: dispatch `undoLayout` + `setDashboardLayoutLocally`; disable when `selectCanUndo` is false
- [x] 5.3 Wire redo button: dispatch `redoLayout` + `setDashboardLayoutLocally`; disable when `selectCanRedo` is false

## 6. Tests

- [x] 6.1 Unit tests for `layoutHistorySlice`: push, undo, redo, stack bounding at 50, redo-stack clear on new push
- [x] 6.2 Unit tests for `setDashboardLayoutLocally` reducer: updates correct dashboard layout, leaves others unchanged
- [x] 6.3 Unit tests for `useLayoutUndoRedo` hook: keyboard dispatch, editable element suppression

## 7. Verification

- [x] 7.1 Run `npm run lint` — zero warnings
- [x] 7.2 Run `npm run format:check`
- [x] 7.3 Run `npm test` — all tests pass
- [x] 7.4 Run `npm run build` — clean build
- [x] 7.5 Playwright smoke: drag a panel, Cmd+Z undoes it, Cmd+Shift+Z redoes it; toolbar buttons match keyboard behavior; 50-step history bound; appearance changes are not undone

## Why

Users who accidentally drag or resize a panel have no way to recover the previous arrangement without manually repositioning it. Undo/redo is a standard editing interaction that significantly reduces friction when working with dashboard layouts.

## What Changes

- A per-dashboard layout history stack is maintained client-side throughout the session
- Keyboard shortcuts `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` trigger undo and redo
- Undo and redo buttons are added to the dashboard toolbar
- History is bounded to 50 entries per dashboard and does not persist across page reloads
- Only layout changes (drag, resize) are tracked — panel appearance changes are excluded

## Capabilities

### New Capabilities

- `layout-undo-redo`: Client-side layout history stack with undo/redo dispatch, keyboard shortcut handling, and toolbar controls

### Modified Capabilities

- `frontend-layout-persistence`: Layout save behavior must be gated so that undo/redo traversal does not trigger a backend persist on every step — only the final settled state is saved

## Impact

- `frontend/src/store/dashboardsSlice.ts` — new history state and undo/redo reducers
- `frontend/src/components/PanelGrid` — layout change handler pushes to history
- Dashboard toolbar component — new undo/redo buttons
- Keyboard event listener — global keydown handler for shortcuts
- No backend changes required

## Context

Panel layout changes (drag and resize) are currently persisted to the backend after a 250ms debounce in `PanelGrid`. There is no history of previous layout states — once a panel is moved, the only recovery is manual repositioning.

The undo/redo system is purely client-side. The backend contract is unchanged; only the frontend gains a transient history stack that survives within a session.

Key existing constraints:
- Layout persist is triggered by `onLayoutChange` inside `PanelGrid` via a 250ms debounce
- Layout state lives in `dashboardsSlice` (via `items[].layout`) and is read by `PanelGrid` as a prop
- React Grid Layout fires `onLayoutChange` continuously during drag — not only on completion

## Goals / Non-Goals

**Goals:**
- Per-dashboard, per-session layout history stack (max 50 entries)
- Undo/redo via `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z`
- Undo/redo toolbar buttons in the app header
- Committed states only in history (not intermediate drag frames)
- Backend persist fires after undo/redo settles (same debounce path)

**Non-Goals:**
- Persisting history across page reloads
- Undoing panel appearance changes
- Undoing panel creation or deletion
- Collaborative undo (no multi-user session awareness)

## Decisions

### 1. Dedicated `layoutHistorySlice` rather than adding to `dashboardsSlice`

`dashboardsSlice` manages server-synchronised state: network status, items, and selections. Layout history is ephemeral, never serialized, and has no async operations. Mixing it into `dashboardsSlice` would add noise to an already complex slice.

**Alternative considered**: Augment `dashboardsSlice` with `layoutHistory` keys alongside existing dashboard items.

**Decision**: New `layoutHistorySlice` with state shape `Record<dashboardId, { past: DashboardLayout[]; future: DashboardLayout[] }>`. The "present" is always read from `dashboardsSlice` (the canonical layout source), so no duplication.

### 2. Commit on `onDragStop` / `onResizeStop`, not `onLayoutChange`

`onLayoutChange` fires for every frame during a drag. Pushing to history on every intermediate frame would flood the stack with meaningless states.

**Alternative considered**: Compare before/after inside `onLayoutChange` and debounce pushes.

**Decision**: Use `onDragStop` and `onResizeStop` callbacks (available on the `Responsive` component from `react-grid-layout`) to push a snapshot of the layout to the history stack only when an interaction completes.

### 3. Keyboard handler as a custom hook at dashboard view level

A global `keydown` handler is needed to intercept `Cmd/Ctrl+Z` before the browser's default undo applies to focused inputs. The handler must be scoped to dashboard context (not active on other views).

**Decision**: A `useLayoutUndoRedo(dashboardId)` hook, used in the dashboard view component. It adds/removes the `keydown` listener on mount/unmount. It skips dispatch when focus is inside an editable element (input, textarea, contenteditable) to avoid conflicting with text editing undo.

### 4. Undo/redo updates `dashboardsSlice` layout directly

When undo or redo fires, the history slice emits the target layout. `PanelGrid` must re-render with the new layout so the grid reflects the change. The cleanest path is to update the layout inside `dashboardsSlice.items` directly via a new synchronous reducer `setDashboardLayoutLocally` (no async thunk, no backend call). The existing `onLayoutChange` → debounce → `updateDashboardLayout` path then fires naturally when the grid acknowledges the new layout, persisting to backend.

**Alternative considered**: Maintain a separate "override layout" in the history slice that `PanelGrid` consults before the slice layout.

**Decision**: `setDashboardLayoutLocally` reducer in `dashboardsSlice`. This keeps `PanelGrid` reading a single source of layout truth.

### 5. History cleared on dashboard switch

History stacks are per-dashboard. When a different dashboard is selected, that dashboard's history resets. History for the previously selected dashboard is preserved in the store map for the session in case the user switches back.

**Decision**: History map is keyed by `dashboardId`. Stacks are lazy-initialized on first push. No explicit clear is required on switch; the viewed dashboard's stack is always current.

## Risks / Trade-offs

- **`onDragStop` fires before `onLayoutChange` settles all breakpoints** → Mitigation: push the layout that `onLayoutChange` last reported (via `latestLayoutRef`) rather than reconstructing from `onDragStop` arguments, which only contain the active breakpoint.
- **Undo/redo triggers `onLayoutChange` on the grid, re-entering the debounce path** → This is acceptable and expected; the debounce naturally coalesces rapid undo keypresses.
- **History is lost on reload** → Accepted per scope. A persistent undo stack would require storing layout diffs in backend; deferred to a future ticket.

## Open Questions

None — scope and approach are clear from the ticket.

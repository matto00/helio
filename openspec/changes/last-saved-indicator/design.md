## Context

HEL-156 introduced `pendingPanelUpdates` in `panelsSlice` with a 250 ms `setTimeout` debounce wired in `PanelGrid.tsx`. The debounce fires too frequently to be meaningful as a "save" cycle and gives users no visibility into save state. `App.tsx`'s `AppShell` already hosts the command bar where undo/redo buttons and the dashboard title breadcrumb live — that is where the save-state indicator belongs.

## Goals / Non-Goals

**Goals:**
- Replace 250 ms debounce with a 30 s `setInterval` sharing one flush function
- Add `lastSavedAt: number | null` to `panelsSlice` state
- Add `SaveStateIndicator` component rendered in `AppShell`'s command bar when a dashboard is open
- Add `useRelativeTime` hook for the live "X ago" label
- Add `beforeunload` guard in `AppShell`

**Non-Goals:**
- No backend changes — `POST /api/panels/updateBatch` is unchanged
- No offline sync, retry queue, or conflict resolution
- No per-field undo/redo

## Decisions

### 1. `setInterval` replaces `setTimeout` debounce

`panelFlushTimerRef` in `PanelGrid.tsx` currently uses `setTimeout` reset on every Redux update. The new behavior is a `setInterval` that fires every 30 s regardless of how frequently updates accumulate. The flush function is extracted as `flushPanelUpdates` (a `useCallback`) so "Save now" can call the same code path without duplication. On "Save now", the existing interval is cleared and restarted (`clearInterval` + a fresh `setInterval`) so the next auto-save is always 30 s from the last manual save.

**Alternative considered**: keep `setTimeout` and just raise the delay. Rejected — a `setInterval` more accurately models "save every N seconds" semantics and doesn't inadvertently delay after every single field change.

### 2. `lastSavedAt` lives in `panelsSlice`, set on `updatePanelsBatch.fulfilled`

The fulfilled case already reconciles panel items; adding `state.lastSavedAt = Date.now()` is a one-liner. This keeps save-timestamp authority in the slice alongside the data it tracks.

### 3. `SaveStateIndicator` is a standalone component, mounted in `AppShell`

`AppShell` already conditionally renders undo/redo and appearance controls when `onDashboardView && selectedDashboard !== null`. The indicator follows the same guard. Keeping it in `AppShell` lets it dispatch `updatePanelsBatch` directly and receive a `onSaveNow` callback prop from the parent — avoiding prop-drilling through `PanelList`/`PanelGrid`.

**Alternative considered**: mount inside `PanelGrid`. Rejected — `PanelGrid` is a grid rendering component; toolbar concerns belong in `AppShell`.

### 4. `useRelativeTime(timestamp)` hook owns the tick

The hook takes a `number | null` timestamp, runs a `setInterval` at 10 s granularity (sufficient for "X minutes ago" fidelity), and returns a formatted string. It clears the interval when the component unmounts. The hook is generic and can be reused by future "last modified" displays.

### 5. `beforeunload` guard in `AppShell` (not `PanelGrid`)

`AppShell` is mounted for the lifetime of the authenticated session, making it the reliable place to add/remove the event listener when `pendingPanelUpdates` changes. `PanelGrid` unmounts on dashboard switch, which would incorrectly suppress the guard between switches.

## Risks / Trade-offs

- [30 s interval means up to 30 s of potential data loss on crash] → Acceptable per ticket; future tickets can tune or add draft-persist to localStorage
- [Timer drift on tab background throttle] → `setInterval` can drift in backgrounded tabs; acceptable — the user isn't editing when tabbed away
- [beforeunload prompt is not guaranteed on mobile browsers] → Platform limitation, not in scope to address

## Planner Notes

- Self-approved: no new external dependencies, no backend schema changes, no breaking API changes
- `panelFlushTimerRef` type changes from `ReturnType<typeof setTimeout>` to `ReturnType<typeof setInterval>` — same opaque number type, no inference impact

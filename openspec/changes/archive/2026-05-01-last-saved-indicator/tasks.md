## 1. Frontend — Redux slice

- [x] 1.1 Add `lastSavedAt: number | null` to `PanelsState` interface and `initialState` in `panelsSlice.ts`
- [x] 1.2 Set `state.lastSavedAt = Date.now()` in the `updatePanelsBatch.fulfilled` extra reducer case

## 2. Frontend — PanelGrid flush timer

- [x] 2.1 Change `panelFlushTimerRef` type from `ReturnType<typeof setTimeout>` to `ReturnType<typeof setInterval>`
- [x] 2.2 Extract a `flushPanelUpdates` `useCallback` that dispatches `updatePanelsBatch` + `clearPendingPanelUpdates` on success
- [x] 2.3 Replace the `setTimeout`-based debounce effect with a `setInterval` of 30 000 ms that calls `flushPanelUpdates` when `pendingPanelUpdates` is non-empty
- [x] 2.4 Update the cleanup effect to use `clearInterval` instead of `clearTimeout`
- [x] 2.5 Accept an optional `onRequestSaveNow` ref/callback prop on `PanelGrid` (or expose flush via a forwarded ref) so `AppShell` can trigger immediate flush and timer reset

## 3. Frontend — useRelativeTime hook

- [x] 3.1 Create `frontend/src/hooks/useRelativeTime.ts` accepting `timestamp: number | null` and returning a formatted string
- [x] 3.2 Implement tick interval (10 s) with `setInterval`, clearing on unmount
- [x] 3.3 Format rules: null → `""`, < 10 s → `"just now"`, < 60 s → `"Xs ago"`, < 3600 s → `"Xm ago"`, otherwise `"Xh ago"`

## 4. Frontend — SaveStateIndicator component

- [x] 4.1 Create `frontend/src/components/SaveStateIndicator.tsx` accepting `onSaveNow: () => void` prop
- [x] 4.2 Read `pendingPanelUpdates` and `lastSavedAt` from Redux inside the component
- [x] 4.3 Render "Unsaved changes" when dirty, "Last saved X ago" (via `useRelativeTime`) when clean with a prior save
- [x] 4.4 Reveal "Save now" button/link on hover using CSS (`:hover` on a wrapper element)
- [x] 4.5 "Save now" calls `onSaveNow` and is disabled / no-ops when `pendingPanelUpdates` is empty
- [x] 4.6 Add `SaveStateIndicator.css` with hover-reveal and layout styles

## 5. Frontend — AppShell wiring

- [x] 5.1 Add a `panelFlushRef` (`useRef`) in `AppShell` to hold the imperative flush+reset function exposed by `PanelGrid`
- [x] 5.2 Pass a `onFlushReady` callback into `PanelGrid` (or use `useImperativeHandle`) so `AppShell` can call flush+reset
- [x] 5.3 Render `<SaveStateIndicator onSaveNow={...} />` in the command bar when `onDashboardView && selectedDashboard !== null`
- [x] 5.4 Add `beforeunload` `useEffect` in `AppShell` that reads `pendingPanelUpdates` from Redux and sets `event.preventDefault()` when non-empty

## 6. Frontend — Tests

- [x] 6.1 Unit test `useRelativeTime`: verify formatting for null, <10 s, <60 s, and >60 s inputs
- [x] 6.2 Unit test `panelsSlice`: verify `lastSavedAt` is set on `updatePanelsBatch.fulfilled` and remains null on initial state
- [x] 6.3 Unit test `SaveStateIndicator`: dirty state shows "Unsaved changes"; clean state with `lastSavedAt` shows relative label; "Save now" calls `onSaveNow`

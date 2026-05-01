# Files Modified — last-saved-indicator

## Modified
- `frontend/src/features/panels/panelsSlice.ts` — added `lastSavedAt: number | null` to state; set on `updatePanelsBatch.fulfilled`
- `frontend/src/components/PanelGrid.tsx` — replaced 250ms debounce with 30s interval; extracted `flushPanelUpdates` and `flushAndReset` callbacks; registered flush with `SaveStateContext`; exposed `PanelGridHandle` via `forwardRef`
- `frontend/src/app/App.tsx` — added `SaveStateContext.Provider`; added `SaveStateIndicator` to command bar; added `beforeunload` guard
- `frontend/src/features/panels/panelsSlice.test.ts` — added `lastSavedAt` tests
- `frontend/src/test/renderWithStore.tsx` — added `lastSavedAt: null` to default panels state

## New
- `frontend/src/context/SaveStateContext.ts` — React context for registering/triggering the panel flush from AppShell
- `frontend/src/hooks/useRelativeTime.ts` — live-ticking relative time hook
- `frontend/src/hooks/useRelativeTime.test.ts` — unit tests for useRelativeTime
- `frontend/src/components/SaveStateIndicator.tsx` — dirty/clean save-state label with hover "Save now"
- `frontend/src/components/SaveStateIndicator.css` — hover-reveal styles
- `frontend/src/components/SaveStateIndicator.test.tsx` — unit tests for SaveStateIndicator

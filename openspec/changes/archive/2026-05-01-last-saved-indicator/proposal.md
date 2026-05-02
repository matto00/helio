## Why

The 250 ms debounce introduced in HEL-156 flushes panel writes too aggressively — it fires on every pause in typing and gives users no visibility into whether their changes have been persisted. A 30-second auto-save with a visible save-state indicator brings the UX in line with modern collaborative tools and surfaces data-loss risk at navigation time.

## What Changes

- Replace the 250 ms debounce timer in `PanelGrid.tsx` with a 30-second `setInterval` auto-save
- Add `lastSavedAt: number | null` to `panelsSlice` state, updated on `updatePanelsBatch.fulfilled`
- Add a `SaveStateIndicator` component to the dashboard toolbar showing "Unsaved changes" or "Last saved X ago"
- Add a custom `useRelativeTime` hook that ticks a live relative-time label
- Add a "Save now" affordance (revealed on hover) that immediately flushes pending updates and resets the timer
- Add a `beforeunload` guard that prompts the user when `pendingPanelUpdates` is non-empty

## Capabilities

### New Capabilities

- `panel-save-state-indicator`: Save-state label and "Save now" control in the dashboard toolbar, backed by `lastSavedAt` slice state and a live-ticking relative-time hook

### Modified Capabilities

- `panel-write-accumulator`: Flush interval changes from 250 ms debounce to 30-second interval; `lastSavedAt` is now tracked; `beforeunload` guard is added

## Impact

- `frontend/src/features/panels/panelsSlice.ts` — new `lastSavedAt` field, updated on `updatePanelsBatch.fulfilled`
- `frontend/src/components/PanelGrid.tsx` — replace debounce with 30s interval; wire "Save now" callback; add `beforeunload` listener
- New: `frontend/src/hooks/useRelativeTime.ts`
- New: `frontend/src/components/SaveStateIndicator.tsx`
- Dashboard toolbar layout updated to host the new component

## Non-goals

- Offline / conflict resolution — changes discarded on navigation are intentional for this phase
- Backend changes — the existing `POST /api/panels/updateBatch` endpoint is unchanged
- Per-field undo/redo — tracked separately in the layout-undo-redo spec

## Why

Panel appearance and title changes each fire an individual `PATCH /api/panels/:id` call immediately on save, producing N write calls per session. HEL-155 introduced `POST /api/panels/updateBatch` and scaffolded the `updatePanelsBatch` thunk, but never wired it up — this ticket closes that gap by accumulating panel writes in Redux and flushing them on the same 250 ms debounce already used for layout.

> **Note — panel.type is immutable post-creation.** `panel.type` (metric / chart / text / table) is fixed at the moment a panel is created (via `PanelList.tsx`) and cannot be changed through any UI after creation. Type accumulation is therefore not applicable and has been removed from scope. The `chartType` field inside `appearance.chart` (bar / line / pie / scatter) is part of appearance and IS accumulated.

## What Changes

- **New Redux state**: a `pendingPanelUpdates` map (`Record<string, PanelUpdateFields>`) added to `panelsSlice` accumulates per-panel field changes
- **New actions**: `accumulatePanelUpdate` merges an incoming field patch into the pending map (optimistically updating the live panel state at the same time); `clearPendingPanelUpdates` drains the map after a successful flush
- **Debounced flush hook**: a `usePanelFlush` hook (or inline effect in PanelGrid / a shared hook) fires `updatePanelsBatch` on a 250 ms debounce whenever `pendingPanelUpdates` is non-empty
- **Call-site migration**: panel rename (PanelGrid) and panel appearance save (PanelDetailModal) dispatch `accumulatePanelUpdate` instead of the direct thunks (`updatePanelTitle`, `updatePanelAppearance`). Panel type is immutable post-creation and has no migration call-site.
- **Remove direct per-panel PATCHs** for the two migrated field types (title, appearance); the individual `PATCH /api/panels/:id` service calls for those paths are no longer invoked on commit
- No backend changes needed — `POST /api/panels/updateBatch` is already implemented

## Capabilities

### New Capabilities

- `panel-write-accumulator`: Redux state and actions that accumulate pending panel field updates and flush them via the batch endpoint on a 250 ms debounce

### Modified Capabilities

- `frontend-layout-persistence`: add the panel flush debounce running alongside the layout debounce (same interval, independent timers)

## Impact

- `frontend/src/features/panels/panelsSlice.ts` — new state, actions, and thunk wiring
- `frontend/src/components/PanelGrid.tsx` — panel rename dispatch changes; flush effect added
- `frontend/src/components/PanelDetailModal.tsx` — appearance save dispatch changes (type is immutable, no change needed)
- `frontend/src/services/panelService.ts` — `updatePanelsBatch` service call (already present); individual per-field patch calls remain for other paths (data binding)
- No backend changes

## Non-goals

- User preference accumulation (HEL-157)
- Layout accumulation (already done in HEL-155)
- Panel `type` field accumulation — `panel.type` is set at creation time and is immutable post-creation; no UI exists to change it
- Panel data-binding (`typeId`, `fieldMapping`, `refreshInterval`) — these remain immediate `PATCH /api/panels/:id` calls for now
- Retry / offline queue logic

## 1. Frontend — Redux State

- [x] 1.1 Add `PanelUpdateFields` type (`{ title?: string; appearance?: PanelAppearance; type?: PanelType }`) to `types/models.ts` — note: `type` is included in the interface for completeness but has no call-site migration because `panel.type` is immutable post-creation (set at panel creation only)
- [x] 1.2 Add `pendingPanelUpdates: Record<string, PanelUpdateFields>` to `PanelsState` interface and `initialState` in `panelsSlice.ts`
- [x] 1.3 Add `accumulatePanelUpdate(state, action: { panelId: string; fields: PanelUpdateFields })` reducer: merges fields into `pendingPanelUpdates[panelId]` and applies optimistic patch to `state.items`
- [x] 1.4 Add `clearPendingPanelUpdates` reducer: resets `pendingPanelUpdates` to `{}`

## 2. Frontend — Debounced Flush

- [x] 2.1 Add `panelFlushTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null)` in `PanelGrid.tsx`
- [x] 2.2 Add flush cleanup `useEffect` in `PanelGrid.tsx` to cancel `panelFlushTimerRef` on unmount
- [x] 2.3 Add flush `useEffect` in `PanelGrid.tsx` that watches `pendingPanelUpdates` from Redux selector: on change, clears existing timer, sets 250 ms timer to dispatch `updatePanelsBatch` then dispatch `clearPendingPanelUpdates` on success

## 3. Frontend — Call-Site Migration

- [x] 3.1 In `PanelGrid.tsx` `commitTitleEdit`: replace `dispatch(updatePanelTitle(...))` with `dispatch(accumulatePanelUpdate({ panelId, fields: { title: trimmed } }))`
- [x] 3.2 In `PanelDetailModal.tsx` appearance save handler: replace `dispatch(updatePanelAppearance(...))` with `dispatch(accumulatePanelUpdate({ panelId, fields: { appearance } }))`
- N/A 3.3 Panel type migration: `panel.type` (metric / chart / text / table) is set at panel creation time in `PanelList.tsx` and is **immutable post-creation** — no UI exists to change it, so there is no call-site to migrate

## 4. Frontend — Batch Payload Builder

- [x] 4.1 Add helper `buildBatchRequest(pending: Record<string, PanelUpdateFields>): UpdatePanelsBatchRequest` in `panelsSlice.ts` or a co-located utility: derives `fields` union and maps each entry to `{ id, ...fields }`

## 5. Tests

- [x] 5.1 Add `panelsSlice` reducer tests: `accumulatePanelUpdate` merges fields and patches `items`; `clearPendingPanelUpdates` resets the map
- [x] 5.2 Add `panelsSlice` reducer test: two accumulations for the same panel ID merge (later write wins per field)
- [x] 5.3 Add `panelsSlice` thunk test: failed `updatePanelsBatch` does NOT clear `pendingPanelUpdates`
- [x] 5.4 Add `PanelGrid` component test: committing a title edit dispatches `accumulatePanelUpdate` instead of `updatePanelTitle`
- [x] 5.5 Add `PanelDetailModal` component test: saving appearance dispatches `accumulatePanelUpdate` instead of `updatePanelAppearance`

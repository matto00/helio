## Context

`panelsSlice.ts` already contains `updatePanelsBatch` (scaffolded in HEL-155) and `panelService.ts`
already has the `updatePanelsBatch` HTTP call. The thunk is never invoked — all three panel field
types (title, appearance, type) still call their individual thunks which hit `PATCH /api/panels/:id`.

Layout persistence (HEL-155 / `frontend-layout-persistence` spec) uses a `useRef` + `setTimeout`
debounce inside `PanelGrid.tsx` with a 250 ms interval. The same pattern applies here.

## Goals / Non-Goals

**Goals:**
- Add `pendingPanelUpdates: Record<string, PanelUpdateFields>` to `PanelsState`
- Add `accumulatePanelUpdate` synchronous action to merge incoming field patches into the map
  and apply the same patch optimistically to `state.items`
- Add `clearPendingPanelUpdates` synchronous action to drain the map after a successful flush
- Wire a 250 ms debounce effect in `PanelGrid.tsx` that fires `updatePanelsBatch` when the map
  is non-empty, then dispatches `clearPendingPanelUpdates`
- Migrate title rename (`commitTitleEdit` in PanelGrid) and appearance save
  (`handleAppearanceSubmit` in PanelDetailModal) to dispatch `accumulatePanelUpdate` instead of
  the individual thunks
- Keep `updatePanelTitle` and `updatePanelAppearance` thunks in place (they remain callable
  but are no longer dispatched from UI components for the migrated paths)

**Non-Goals:**
- Panel `type` field accumulation — `panel.type` (metric / chart / text / table) is set at panel
  creation time in `PanelList.tsx` and is **immutable post-creation**. No UI exists to change it
  after a panel is created, so there is no call-site to migrate.
- Panel data-binding (`updatePanelBinding`) — remains immediate PATCH, unchanged
- Backend changes
- Retry / offline queue
- Layout accumulation (already done)

## Decisions

### Decision 1: New state shape in `panelsSlice`

`pendingPanelUpdates` is `Record<panelId, { title?: string; appearance?: PanelAppearance; type?: PanelType }>`.
Adding to existing slice state is the least-disruptive path; avoids a second Redux slice or
ephemeral component-local state that can't survive re-renders between debounce ticks.

Alternatives: (a) a separate `pendingPanelUpdatesSlice` — unnecessary complexity for what is
essentially a write buffer; (b) `useRef` inside a component — loses cross-component visibility
and makes the accumulation non-testable via Redux.

### Decision 2: Optimistic update inline in `accumulatePanelUpdate` reducer

`accumulatePanelUpdate` both merges into `pendingPanelUpdates` and patches `state.items` directly.
This keeps optimistic state collocated with the accumulation, matching how `updatePanelTitle.fulfilled`
and `updatePanelAppearance.fulfilled` currently work, without needing thunk overhead for a sync op.

### Decision 3: Debounce lives in `PanelGrid.tsx` (not a custom hook)

The layout debounce is already in `PanelGrid.tsx` using `useRef`/`setTimeout`. Placing the panel
flush debounce in the same component keeps both flush timers visible in one place and avoids
introducing a hook abstraction for a two-timer pattern. If a third flush type is added in the
future, extraction to a `useFlushDebounce` hook can happen then.

### Decision 4: Flush uses `updatePanelsBatch` with full pending map snapshot

On debounce fire, the current `pendingPanelUpdates` map is converted to the
`UpdatePanelsBatchRequest` shape and dispatched. On `fulfilled`, `clearPendingPanelUpdates` is
dispatched. On rejection, the map is **not** cleared — the next debounce tick retries automatically.

The `UpdatePanelsBatchRequest` shape (from HEL-155 types) expects:
`{ fields: string[]; panels: Array<{ id: string; title?: string; appearance?: PanelAppearance; type?: PanelType }> }`.
Fields list is derived from the union of all keys present in the pending map entries.

## Risks / Trade-offs

- **Stale flush on unmount** → The existing layout debounce has a cleanup `useEffect` that clears
  `persistTimerRef`. The same cleanup pattern is applied to the new panel flush timer. Any
  pending updates that haven't flushed when the component unmounts will be lost — acceptable
  because navigating away from a dashboard is a natural commit boundary.

- **Concurrent batch + individual PATCH** → Data-binding still fires `PATCH /api/panels/:id`.
  If a binding save and a pending title accumulation race, the server applies them independently —
  no conflict since they touch different fields.

## Planner Notes

Self-approved: purely frontend, additive state, no new dependencies, no API contract changes.
The `UpdatePanelsBatchRequest` and `UpdatePanelsBatchResponse` types already exist in
`frontend/src/types/models.ts` (added in HEL-155).

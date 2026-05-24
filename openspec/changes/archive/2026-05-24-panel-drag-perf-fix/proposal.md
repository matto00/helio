## Why

Dragging a panel on a dashboard with ~10 panels triggers O(N) expensive re-renders per drag tick because `PanelCardBody` is un-memoized and `onLayoutChange` fires on every mouse-move event. This makes the core editing interaction visibly laggy, degrading the dashboard authoring experience.

## What Changes

- Wrap `PanelCardBody` in `React.memo` with a stable props contract so non-dragged panels skip re-renders during drag
- Stabilize `usePanelData` hook outputs so that referential equality holds across renders (prevent new object/array identity on each call)
- Suppress mid-drag re-renders of panel bodies via a `isDragging` ref/state gating mechanism (panels freeze during drag, repaint on `onDragStop`)
- Memoize all callbacks and derived values passed into the `ResponsiveGridLayout` children to prevent identity churn on each layout tick

## Capabilities

### New Capabilities
<!-- None — this is a pure performance improvement with no new user-visible behavior -->

### Modified Capabilities
<!-- None — layout persistence behavior (debounced 250ms write) is unchanged; zoom/HEL-153 interactions are unchanged -->

## Impact

- `frontend/src/features/panels/ui/PanelGrid.tsx` — primary change site: memoization, drag freeze logic
- `frontend/src/features/panels/hooks/usePanelData.ts` — stabilize returned references
- No backend changes, no API changes, no schema changes
- No regression to `frontend-layout-persistence` or `panel-grid-zoom-gestures` specs

## Non-goals

- Virtualizing the panel grid (out of scope for this ticket)
- Changing the 250ms layout-persistence debounce
- Profiler instrumentation shipped to production

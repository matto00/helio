## Context

`PanelGrid.tsx` renders all panels inside a `ResponsiveGridLayout` (react-grid-layout). During drag,
`onLayoutChange` fires on every mouse-move event. `PanelCardBody` is a plain function component, so
every layout-state update causes all N panels to re-render — including expensive `usePanelData` invocations
and recharts chart repaints. With 9–10 panels this produces visible jank.

Current pain points confirmed from reading the source:
1. `PanelCardBody` at line 75: no `React.memo`, re-renders on every parent state change.
2. `onLayoutChange` at line 253: calls `markLayoutChanged` unconditionally on every tick (correct for
   persistence debounce, but also triggers state updates that cascade to all card renders).
3. `getPanelCardStyle` at line 53: called inline inside `.map()` — returns a new object identity each render,
   breaking `React.memo` if panel style is a prop.
4. `usePanelData` at line 88–107: constructs new `data`/`rawRows`/`headers` objects on every call even when
   source rows haven't changed, because `headers` and `rawRows` are built from scratch each render.
5. Event handlers inside `.map()` (e.g. `onClick={(e) => handlePanelCardClick(panel.id, e)}`) create new
   function identities each render — would break memoized children if not handled.

## Goals / Non-Goals

**Goals:**
- Only the actively dragged panel (and the RGL grid wrapper) re-renders during a drag operation
- `PanelCardBody` skips re-renders when its `panel` prop is referentially unchanged
- `usePanelData` returns stable `data`/`rawRows`/`headers` references when underlying rows are unchanged
- No regression to layout persistence (250ms debounce write unchanged)
- No regression to zoom/scaled-strategy behavior (HEL-153)

**Non-Goals:**
- Virtualizing the panel grid
- Eliminating all re-renders (the dragged panel itself must re-render to track position)
- Profiler instrumentation in production code

## Decisions

### D1: Memoize `PanelCardBody` with `React.memo`

Wrap `PanelCardBody` in `React.memo`. Its only prop is `panel: Panel`. Panel objects are immutable case-class
snapshots from Redux — the selector returns the same reference when nothing changed, so `React.memo`'s
shallow-equal check reliably bails out for non-dragged panels.

Alternative considered: lift `PanelCardBody` state (dispatch, pagination) up to `PanelGrid`. Rejected —
adds coupling and splits concerns that are logically grouped in the body.

### D2: Freeze panel bodies mid-drag with `isDragging` state

Add `isDragging` state to `PanelGrid`. On `onDragStart`, set `isDragging = true`; on `onDragStop`, set
`isDragging = false`. Pass `isDragging` to each `PanelCardBody` (as `frozen: boolean`). When `frozen`,
`PanelCardBody` short-circuits and returns `null` (or a cached snapshot) so chart/table bodies don't
repaint during drag. Re-renders only when `frozen` flips back to `false`.

Alternative: CSS `pointer-events: none` + `will-change: transform` on bodies. Doesn't prevent React
re-render cascade; only a visual hint to the compositor. Rejected as insufficient alone.

Alternative: `useLayoutEffect` + `display: none`. Rejected — causes layout reflows.

Design choice: return `null` (hide body) during drag rather than freezing via `useMemo` snapshot, because
hiding is simpler, guarantees no repaint cost, and the drag animation itself communicates the panel identity
clearly enough without the body. Restore immediately on `onDragStop`.

### D3: Stabilize `usePanelData` return references with `useMemo`

`headers` and `rawRows` are reconstructed on every call from `rows`. Wrap the derived values in `useMemo`
keyed on the `rows` array reference from the Redux store. Since Redux slices return the same array
reference when nothing changed, the memo hits reliably.

Similarly, `data` (the field-mapped first-row object) is memoized on `rows` + `fieldMapping`.

### D4: Memoize `getPanelCardStyle` per panel

Move `getPanelCardStyle` result into a `useMemo` inside the card render (or extract a `PanelCard`
component that memoizes the style). The `theme` string and `panel.appearance` fields are stable when
nothing changes.

Implementation: extract a `PanelCard` component wrapping the `<article>`, memoized with `React.memo`,
that receives `panel`, `theme`, and the relevant callbacks. Inner callbacks that close over `panel.id`
are wrapped in `useCallback`.

### D5: Stable callback identities for handlers inside `.map()`

Current code passes `(e) => handlePanelCardClick(panel.id, e)` as inline lambdas. These create new
identity each render, defeating memoization of any memoized child. Solution: extract a `PanelCard`
component (see D4) so the handler is defined once inside the component and only recreated when `panel.id`
changes (via `useCallback`).

## Risks / Trade-offs

- [Risk] Hiding panel body during drag surprises users who expect to see content while dragging.
  → Mitigation: the drag handle and panel title remain visible; body disappears only during active drag,
    which is a common pattern in drag-to-rearrange UIs. Duration is typically < 500ms.

- [Risk] `React.memo` with panel objects: if a Redux action inadvertently mutates-and-returns a new Panel
  reference for all panels, memoization won't help.
  → Mitigation: Redux Toolkit's `createSlice` uses Immer, which only returns new references for actually
    changed items. This is the expected behavior and is already relied upon elsewhere in the codebase.

- [Risk] `frozen` prop added to `PanelCardBody` changes the component's interface.
  → Mitigation: `PanelCardBody` is a private component (not exported), so no external contract change.

## Migration Plan

Frontend-only change. No backend changes, no migrations. Deployed atomically with the batch branch merge.
Rollback: revert the commit.

## Open Questions

None — all decisions self-approved.

## Planner Notes

Self-approved: pure frontend performance optimization, no new dependencies, no API changes, no breaking
changes. Scope is well-contained within two files (`PanelGrid.tsx`, `usePanelData.ts`). Extraction of
`PanelCard` component is an implementation detail of the refactor, not a separate capability.

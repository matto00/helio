# HEL-284 — [Perf] Dragging a panel is laggy on dashboards with ~10 panels — re-render cascade

## Symptom

Dragging a panel on a dashboard with ~10 panels is visibly laggy/janky. Degrades the core dashboard editing interaction — flagged as a major concern during the HEL-128 UI-polish session (observed live on the seeded "Evaluation Dashboard", 9 panels).

## Reproduction

1. Open a dashboard with ~10 panels (the dev "Evaluation Dashboard" has 9; add one more or use a chart-heavy board)
2. Grab a panel by its move handle and drag it around the grid
3. Observe frame drops / lag, worse with chart panels present

## Suspected root cause (from code inspection)

`frontend/src/features/panels/ui/PanelGrid.tsx`:

* `PanelCardBody` (line ~75) is a plain, un-memoized function component, and each instance calls `usePanelData(panel)` (line ~78). There is no `React.memo` on the card or body.
* `ResponsiveGridLayout`'s `onLayoutChange` fires continuously during a drag (line ~253), updating layout state on every tick.
* Because the cards aren't memoized, each layout-state update re-renders all ~10 panels — including re-invoking `usePanelData` and re-rendering chart bodies (the most expensive case) — for every drag frame, not just the panel being moved.

Net effect: O(N) expensive re-renders per drag tick instead of O(1).

## Investigation surface

* `frontend/src/features/panels/ui/PanelGrid.tsx` — `PanelCardBody`, the `.map()` render, `onDragStart`/`onDragStop`/`onLayoutChange` handlers (lines ~225–253, ~347)
* `frontend/src/features/panels/hooks/usePanelData.ts` — does it recompute/refetch on every render? Stable references?
* Chart panel render path (recharts or equivalent) — re-render cost per panel
* Existing config: layout changes are debounced 250ms before persisting (per CLAUDE.md), but that debounce is on the network write, not on the re-render cascade during drag

## Likely fixes (decide in design)

* Wrap the panel card / `PanelCardBody` in `React.memo` with a stable props contract so only the dragged panel re-renders
* Memoize/stabilize `usePanelData` outputs (avoid new object/array identities each render)
* Suppress non-essential re-renders mid-drag (e.g. freeze panel bodies between `onDragStart` and `onDragStop`); keep `useCSSTransforms` on
* Verify `ResponsiveGridLayout` isn't recreating `layouts`/children identities each render

## Acceptance bar

* Dragging a panel on a 10+ panel dashboard (incl. chart panels) is smooth (no perceptible jank)
* A React Profiler trace shows only the dragged panel (and the grid wrapper) re-rendering during a drag — not all N panels
* No regression to layout persistence (still debounced) or to the HEL-153/zoom interactions

## Related

* HEL-128 — surfaced during this UI-polish session
* HEL-133 — adjacent perf-hardening (repository pagination); same "scales poorly with N" theme
* HEL-153 — prior grid/zoom interaction work (don't regress)

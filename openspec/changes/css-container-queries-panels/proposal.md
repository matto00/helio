## Why

Panel content currently uses viewport-relative or fixed sizing, so elements do not adapt when a panel is dragged or resized in the grid. CSS container queries let each panel's inner content respond to the panel container's own dimensions, enabling correct re-flow as the user resizes panels at runtime.

## What Changes

- Add `container-type: size` (and `container-name`) to the panel card container (`.panel-grid-card`) so child elements can use `@container` rules.
- Add `@container` breakpoint rules for each panel type (metric, text, table, chart) that adjust typography, spacing, and layout thresholds based on the panel's pixel dimensions rather than the viewport.
- Metric panel: scale value font-size up (from `2rem` baseline) at larger container heights using `@container` size queries.
- Text panel: adjust line-height and padding at small container heights to maximize readability.
- Table panel: reduce cell padding at small container heights to show more rows.
- Chart panel: no CSS changes needed (ECharts already fills container via `style={{ height:"100%", width:"100%" }}`).
- Add a thin React hook (`usePanelSize`) — only if `ResizeObserver` is needed as a polyfill path or for JS-driven thresholds — otherwise rely purely on CSS.

## Capabilities

### New Capabilities

- `panel-container-queries`: CSS container query infrastructure on panel cards — establishes `@container` context and per-panel-type responsive rules for re-flow on grid resize.

### Modified Capabilities

- `panel-content-sizing`: The sizing baseline from HEL-158 now has container-query overrides layered on top; the base values remain but `@container` rules extend them for different size buckets.

## Impact

- **Frontend CSS**: `PanelCard.css` (or equivalent panel stylesheet) gains container type declaration and `@container` rules.
- **Frontend components**: Minimal — mainly structural; `PanelCard` wrapper element may need a CSS class or `style` prop for `container-type: size`.
- **No backend changes.**
- **No API changes.**
- **No breaking changes.**

## Non-goals

- Content-density improvements for sparse panels (metric enlargement, table row-height changes) — those are separate follow-on tickets.
- Polyfilling container queries for browsers that don't support them (all modern browsers do as of 2023).
- ResizeObserver-based JS layout logic — CSS container queries are sufficient.

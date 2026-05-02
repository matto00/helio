## Why

The panel grid wraps `react-grid-layout` in a CSS `scale()` transform to implement zoom, but
`react-grid-layout` computes drag and resize coordinates from raw pointer event positions without
accounting for the transform. At any zoom level other than 100%, pointer hit targets are offset from
their visual positions, making drag and resize broken or severely degraded.

## What Changes

- Pass the current `zoomLevel` value from `PanelList` down to `PanelGrid` as a prop.
- Set the `positionStrategy` prop on the `<Responsive>` grid component using
  `createScaledStrategy(zoomLevel)` from `react-grid-layout/core` so `react-grid-layout` accounts
  for the CSS scale transform when computing drag and resize positions. In
  `react-grid-layout@2.2.2` the legacy `transformScale` prop is superseded by the `positionStrategy`
  API; `createScaledStrategy()` is the built-in factory for scale-aware coordinate remapping.
- Update the existing `PanelGrid` and `PanelList` tests to cover zoom prop propagation.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `frontend-theme-system`: add a requirement that panel drag and resize remain correct at all
  supported zoom levels (0.5–2.0) by supplying `positionStrategy` with `createScaledStrategy()` to
  the grid.

## Impact

- `frontend/src/components/PanelList.tsx` — pass `zoomLevel` to `PanelGrid`
- `frontend/src/components/PanelGrid.tsx` — accept `zoomLevel` prop and forward it as `positionStrategy` via `createScaledStrategy()`
- `frontend/src/components/PanelList.test.tsx` — extend zoom interaction tests
- `frontend/src/components/PanelGrid.test.tsx` — assert `positionStrategy` (from `createScaledStrategy(zoomLevel)`) is forwarded to `<Responsive>`

## Non-goals

- No changes to the zoom range [0.5, 2.0] or step increment.
- No backend changes.
- No visual / CSS changes to the zoom container.

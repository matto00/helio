## Context

`PanelList` wraps `PanelGrid` in a `div.panel-list__zoom-container` with
`transform: scale(zoomLevel); transform-origin: top left`. `react-grid-layout`'s drag and resize
handlers use raw `MouseEvent.clientX/Y` to compute pointer deltas. When a CSS scale transform is
applied to an ancestor, the pointer's logical coordinates within the grid are scaled, but
`react-grid-layout` does not account for this — resulting in incorrect drag offsets and hit-target
misalignment at any zoom level other than 1.0.

`react-grid-layout@2.2.2` exposes a `positionStrategy` prop on the `<Responsive>` component and
provides a `createScaledStrategy(scale)` factory in `react-grid-layout/core`. Passing
`positionStrategy={createScaledStrategy(zoomLevel)}` instructs the library to account for the CSS
scale transform when computing internal pointer deltas, correcting exactly this class of bug. The
legacy `transformScale` prop (in `legacy.d.ts`) is superseded by this modern API.

## Goals / Non-Goals

**Goals:**
- Drag and resize work accurately at 50%, 75%, 125%, and 150% zoom.
- No regressions at 100% zoom.
- Minimal surface change — one new prop threaded from `PanelList` through to `<Responsive>`.

**Non-Goals:**
- Changing zoom range, step, UI, or persistence logic.
- Any backend work.

## Decisions

### Decision: Use `positionStrategy` with `createScaledStrategy()`, not coordinate remapping in event handlers

In `react-grid-layout@2.2.2` the modern API for correcting scale-transform pointer offsets is
`positionStrategy={createScaledStrategy(zoomLevel)}` (imported from `react-grid-layout/core`).
The older `transformScale` prop lives in `legacy.d.ts` and is superseded by this approach.
`createScaledStrategy()` is the built-in factory for creating a position strategy that accounts for
CSS scale transforms; it is more explicit and forward-compatible than the legacy prop. Manually
remapping coordinates in `onDrag*` / `onResize*` callbacks would replicate the same arithmetic in a
less-maintained place and would break on library upgrades. Using the built-in API is the obvious
and forward-compatible choice.

### Decision: Prop-thread `zoomLevel` from `PanelList` into `PanelGrid`

`PanelGrid` currently has no knowledge of the zoom level; the scale transform lives entirely in
`PanelList`. The cleanest approach is to add a `zoomLevel: number` prop to `PanelGridProps` (default
`1.0` to keep existing callers valid) and pass it through `createScaledStrategy(zoomLevel)` as `positionStrategy` on `<Responsive>`.

Alternative considered: storing zoom in Redux so `PanelGrid` reads it directly. Rejected — zoom is
local UI state scoped to `PanelList`, and introducing a Redux dependency for a single display prop
would add unnecessary coupling.

## Risks / Trade-offs

- [Risk] `react-grid-layout` version doesn't support `positionStrategy` / `createScaledStrategy` →
  Mitigation: verified against installed version `react-grid-layout@2.2.2`; both `positionStrategy`
  prop and `createScaledStrategy` factory are present in the package's main type definitions (not
  in legacy.d.ts). The legacy `transformScale` prop is available as a fallback but is intentionally
  not used.
- [Risk] Minor float imprecision at extreme zoom steps (0.1 increments) → Mitigation: none needed;
  this is inherent to floating-point and matches the existing zoom step design.

## Planner Notes

Self-approved: change is a single prop addition with no API, schema, or backend impact.
Zoom range and step remain unchanged; only the correctness of drag/resize at non-100% zoom is fixed.

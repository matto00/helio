## Why

Dashboard users need to scale the panel grid up or down to fit more panels in
view or inspect individual panels more clearly. The scale transform and zoom
controls are partially implemented but missing CSS rules, overflow clipping, and
test coverage for the transform behaviour.

## What Changes

- Add missing CSS rules to `PanelList.css` for `.panel-list__zoom-container`,
  `.panel-list__zoom-controls`, `.panel-list__zoom-button`, `.panel-list__zoom-level`,
  and `.panel-list__zoom-reset`
- Add `overflow: hidden` to `.panel-list` to clip content that escapes the
  container when zoomed in past the viewport boundary
- Add a Jest test asserting that the zoom container div receives the correct
  `transform`, `transformOrigin`, `width`, and `height` inline styles when the
  zoom level is non-default

## Capabilities

### New Capabilities
- `dashboard-zoom`: CSS scale transform applied to the panel grid container,
  with matching zoom controls, overflow clipping, and per-dashboard persistence

### Modified Capabilities
<!-- None — no existing spec covers dashboard zoom -->

## Impact

- `frontend/src/components/PanelList.tsx` — no logic changes; already correct
- `frontend/src/components/PanelList.css` — add zoom-related rules
- `frontend/src/components/PanelList.test.tsx` — add transform assertion test

## Non-goals

- Redux-driven zoom state (component-local state is intentional for HEL-151)
- Gesture/pinch zoom (HEL-152 scope)
- Keyboard zoom shortcuts

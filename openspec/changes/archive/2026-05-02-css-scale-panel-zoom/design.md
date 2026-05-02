## Context

`PanelList.tsx` already renders a `.panel-list__zoom-container` div with inline
styles: `transform: scale(zoomLevel)`, `transformOrigin: "top left"`,
`height: ${100 / zoomLevel}%`, `width: ${100 / zoomLevel}%`. The zoom controls
and preference persistence are also in place. What is missing is the CSS
class definitions for the zoom-related selectors and overflow clipping on the
parent `.panel-list`.

## Goals / Non-Goals

**Goals:**
- Add all missing CSS class definitions so the zoom UI renders correctly
- Add `overflow: hidden` to `.panel-list` to clip overflowing zoomed content
- Add a test that asserts the inline transform styles are applied when zoom
  level is non-default (e.g. 1.5)

**Non-Goals:**
- Changing zoom logic or state management
- Redux-driven zoom state
- Gesture or keyboard zoom

## Decisions

### CSS-only fix — no TSX changes
The inline styles applied by `PanelList.tsx` are correct as-is (scale +
inverse dimension compensation). Only CSS additions are required.

### `overflow: hidden` on `.panel-list`
Without this, a zoomed-in grid overflows the panel column. The `.panel-list`
element has `min-height: 100%` and fills the right column; clipping here is
safe and doesn't affect the scroll container above it.

### Test approach — check DOM style attribute
JSDOM does not render CSS transforms visually, but we can assert that the
container div has the expected `style` attribute values. The test renders
`PanelList` with a mocked zoom preference set to 1.5 and asserts the inline
`transform`, `width`, and `height` values.

## Risks / Trade-offs

- `overflow: hidden` on `.panel-list` suppresses any future overlay or
  dropdown that might overflow the column boundary → Mitigation: overflow
  menus (e.g. `ActionsMenu`) use fixed positioning and are unaffected.

## Planner Notes

Self-approved: pure CSS addition + one test. No new dependencies, no API
changes, no architectural decisions. The TSX logic for zoom was implemented in
HEL-157 and is confirmed correct.

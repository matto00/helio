## MODIFIED Requirements

### Requirement: Zoom controls render as a floating bottom-right widget
The zoom controls (zoom in, zoom out, reset, level label) SHALL be rendered as a floating widget
anchored to the bottom-right corner of the `.panel-list` container via
`position: absolute; bottom: 20px; right: 20px` when a dashboard is selected.
The widget SHALL NOT appear in the dashboard header.
On the phone shell (viewport at or below 768px, the boundary DESIGN.md §4 and §12 use for the phone layout) the
widget SHALL be hidden, so nothing but the glass nav floats over panel content — zoom controls are desktop chrome and
pinch-zoom is the native gesture on touch devices.

#### Scenario: Dashboard selected — widget rendered
- **WHEN** a dashboard is selected and the viewport is wider than 768px
- **THEN** zoom in, zoom out, and reset zoom buttons are rendered inside
  `.panel-list__zoom-widget` at the bottom-right of the panel area

#### Scenario: No dashboard selected — widget absent
- **WHEN** no dashboard is selected
- **THEN** `.panel-list__zoom-widget` is not rendered

#### Scenario: Phone viewport — widget hidden
- **WHEN** a dashboard is selected and the viewport is at or below 768px (including 431px–768px)
- **THEN** the zoom widget is not visible and nothing other than the glass nav floats over panel content

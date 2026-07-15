## MODIFIED Requirements

### Requirement: Zoom controls render as a floating bottom-right widget
The zoom controls (zoom in, zoom out, reset, level label) SHALL be rendered as a floating widget
anchored to the bottom-right corner of the `.panel-list` container via
`position: absolute; bottom: 20px; right: 20px` when a dashboard is selected.
The widget SHALL NOT appear in the dashboard header.
Below the 430px phone breakpoint (ratified in `DESIGN.md` §4) the widget SHALL be hidden — zoom
controls are desktop chrome and pinch-zoom is the native gesture on touch devices.

#### Scenario: Dashboard selected — widget rendered
- **WHEN** a dashboard is selected
- **THEN** zoom in, zoom out, and reset zoom buttons are rendered inside
  `.panel-list__zoom-widget` at the bottom-right of the panel area

#### Scenario: No dashboard selected — widget absent
- **WHEN** no dashboard is selected
- **THEN** `.panel-list__zoom-widget` is not rendered

#### Scenario: Phone viewport — widget hidden
- **WHEN** a dashboard is selected and the viewport is below the 430px phone breakpoint
- **THEN** the zoom widget is not visible

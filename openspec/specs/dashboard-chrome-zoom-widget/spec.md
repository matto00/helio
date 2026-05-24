# dashboard-chrome-zoom-widget Specification

## Purpose
TBD - created by archiving change rework-dashboard-chrome. Update Purpose after archive.
## Requirements
### Requirement: Zoom controls render as a floating bottom-right widget
The zoom controls (zoom in, zoom out, reset, level label) SHALL be rendered as a floating widget
anchored to the bottom-right corner of the `.panel-list` container via
`position: absolute; bottom: 20px; right: 20px` when a dashboard is selected.
The widget SHALL NOT appear in the dashboard header.

#### Scenario: Dashboard selected — widget rendered
- **WHEN** a dashboard is selected
- **THEN** zoom in, zoom out, and reset zoom buttons are rendered inside
  `.panel-list__zoom-widget` at the bottom-right of the panel area

#### Scenario: No dashboard selected — widget absent
- **WHEN** no dashboard is selected
- **THEN** `.panel-list__zoom-widget` is not rendered

### Requirement: Zoom widget is accessible
The zoom widget container SHALL carry `role="group"` and `aria-label="Zoom controls"` so
assistive technology can identify the group. Individual buttons SHALL retain their existing
aria-labels: "Zoom in", "Zoom out", "Reset zoom".

#### Scenario: Accessible group label present
- **WHEN** a dashboard is selected and the zoom widget is rendered
- **THEN** the widget root element has `role="group"` and `aria-label="Zoom controls"`

### Requirement: Zoom widget does not overlap the sidebar or header
The widget SHALL use `position: absolute` (not `position: fixed`) so it is contained within
the `.panel-list` scroll boundary and does not overflow into adjacent layout regions.

#### Scenario: Widget is contained in panel area
- **WHEN** the zoom widget is rendered
- **THEN** it is positioned relative to `.panel-list`, not the viewport


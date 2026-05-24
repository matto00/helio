## MODIFIED Requirements

### Requirement: Zoom controls appear when a dashboard is selected
The dashboard panel area SHALL show Zoom In, Zoom Out, and Reset Zoom buttons along with a
current-level percentage label when a dashboard is selected. These controls SHALL be rendered
inside the floating zoom widget (`.panel-list__zoom-widget`) at the bottom-right of the panel
area — NOT in the header.

#### Scenario: Dashboard selected
- **WHEN** a dashboard is selected
- **THEN** zoom in (+), zoom out (−), and reset buttons are rendered in the floating bottom-right
  zoom widget

#### Scenario: No dashboard selected
- **WHEN** no dashboard is selected
- **THEN** the zoom widget is not rendered and zoom controls are not visible

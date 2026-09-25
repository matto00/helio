## MODIFIED Requirements

### Requirement: Clicking the panel body opens the detail modal
The panel card body SHALL respond to a click that is not on an interactive control (button, input, anchor, resize handle, or a clickable chart series element — see `chart-drilldown-inspect`) by opening the panel detail modal for that panel.

#### Scenario: Click on panel body opens modal
- **WHEN** the user clicks on the panel body (not on the drag handle, actions menu, title input, resize handle, or a chart series element)
- **THEN** the panel detail modal opens for the clicked panel

### Requirement: Interactive controls within the panel do not open the detail modal
Clicks that originate on interactive controls inside the panel card (buttons, inputs, anchors, the `.react-resizable-handle` element, or a clickable chart series element on a chart panel) SHALL NOT open the detail modal.

#### Scenario: Clicking the drag handle does not open the modal
- **WHEN** the user clicks the drag handle button
- **THEN** the panel detail modal does NOT open

#### Scenario: Clicking the actions menu trigger does not open the modal
- **WHEN** the user clicks the actions menu trigger button
- **THEN** the panel detail modal does NOT open and the actions menu opens normally

#### Scenario: Clicking a chart series element opens Inspect, not the detail modal
- **WHEN** the user clicks a clickable element of a chart panel's series (a bar, line point, pie slice, or scatter point)
- **THEN** the panel detail modal does NOT open, and the chart-drilldown-inspect view opens instead

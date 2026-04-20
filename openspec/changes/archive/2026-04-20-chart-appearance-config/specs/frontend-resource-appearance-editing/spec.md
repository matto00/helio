## MODIFIED Requirements

### Requirement: Users can edit panel appearance from the frontend
The frontend MUST provide controls for editing supported panel appearance settings and apply saved values to rendered panels. The panel appearance controls MUST be hosted in the Appearance tab of the panel detail modal (not a popover). For chart panels, the Appearance tab MUST additionally display a Chart section with controls for series colors, legend, tooltip, and axis labels, with live preview updating as settings change.

#### Scenario: Panel appearance is customized
- **GIVEN** a dashboard with panels is selected
- **WHEN** the user opens the panel detail modal and changes appearance controls in the Appearance tab
- **THEN** the frontend submits the updated panel `appearance`
- **AND** the rendered panel reflects the saved background, color, and transparency settings

#### Scenario: Chart section is shown only for chart panels
- **WHEN** the user opens the panel detail modal for a panel with `type: "chart"`
- **THEN** a "Chart" section is visible in the Appearance tab with series color, legend, tooltip, and axis label controls
- **AND** when opened for a non-chart panel the Chart section is not shown

#### Scenario: Series colors can be changed
- **WHEN** the user changes a color swatch in the Chart section
- **THEN** the chart preview inside the modal updates immediately to use the new color

#### Scenario: Legend visibility can be toggled
- **WHEN** the user toggles the legend show/hide control
- **THEN** the chart preview immediately shows or hides the legend

#### Scenario: Legend position can be changed
- **WHEN** the user selects a legend position (top/bottom/left/right)
- **THEN** the chart preview immediately moves the legend to the selected position

#### Scenario: Tooltip can be toggled
- **WHEN** the user toggles the tooltip enabled/disabled control
- **THEN** the chart preview reflects the tooltip state immediately

#### Scenario: Axis labels can be toggled independently
- **WHEN** the user toggles the X or Y axis label show/hide control
- **THEN** the chart preview immediately shows or hides the respective axis label

#### Scenario: Chart appearance settings persist after save
- **WHEN** the user saves chart appearance settings
- **THEN** the chart panel in the grid renders with the saved settings after the modal closes

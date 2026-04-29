# chart-type-selector Specification

## Purpose
Controls the chart rendering type (bar, line, pie, scatter) for chart panels. The selector appears in the Appearance tab of the panel detail modal and persists the selected type to the backend via the panel appearance save flow.
## Requirements
### Requirement: Panel detail modal shows chart type selector for chart panels
The Appearance tab in the panel detail modal MUST display a chart type selector when `panel.type` is `"chart"`. The selector MUST NOT be visible for non-chart panel types.

#### Scenario: Chart type selector is visible for chart panels
- **WHEN** a panel with `type: "chart"` is opened in the detail modal
- **THEN** the Appearance tab contains a chart type selector control

#### Scenario: Chart type selector is absent for non-chart panels
- **WHEN** a panel with `type` other than `"chart"` is opened in the detail modal
- **THEN** no chart type selector is present in the Appearance tab

### Requirement: Chart type selector offers at least four chart types
The selector MUST present at minimum four options: line, bar, pie, and scatter. Each option MUST have a visible label.

#### Scenario: All four chart types are listed
- **WHEN** the chart type selector is displayed
- **THEN** it contains options for line, bar, pie, and scatter

### Requirement: Selected chart type is included in the Save payload
When the user clicks Save in the Appearance tab, the selected `chartType` MUST be included in the appearance update sent to the backend.

#### Scenario: Save persists chartType
- **WHEN** the user selects a chart type and clicks Save
- **THEN** the appearance update payload includes the selected `chartType`
- **AND** a subsequent page reload shows the same chart type

### Requirement: Chart type selector is visually distinct from colour and transparency controls
The chart type selector MUST be separated from colour pickers and the transparency slider so that it is clearly identified as a chart-specific control.

#### Scenario: Selector is labelled and grouped separately
- **WHEN** the Appearance tab is displayed for a chart panel
- **THEN** the chart type selector has a visible label and is visually separated from the colour/transparency controls

### Requirement: Default chart type is line when none is stored
If no `chartType` is stored in the panel's appearance, the selector MUST default to `"line"`.

#### Scenario: Unset chartType defaults to line
- **WHEN** a chart panel with no stored `chartType` is opened in the detail modal
- **THEN** the chart type selector shows "line" as the selected value


# echarts-chart-panel Specification

## Purpose
TBD - created by archiving change echarts-base-chart-panel. Update Purpose after archive.
## Requirements
### Requirement: Chart panel renders a live ECharts instance
The system SHALL mount an ECharts chart inside any panel whose `type` is `"chart"`, rendering the chart type
specified by `appearance.chartType`. If `appearance.chartType` is absent or unrecognised, the panel MUST
default to a line chart. The chart MUST fill the available panel card body area.

#### Scenario: Chart panel mounts an ECharts instance
- **WHEN** a panel with `type: "chart"` is displayed in the grid
- **THEN** an ECharts canvas element is rendered inside the panel card body

#### Scenario: Chart panel renders the stored chart type
- **WHEN** a panel with `type: "chart"` has `appearance.chartType` set to a supported type
- **THEN** the ECharts instance renders that chart type (e.g. bar renders a bar chart)

#### Scenario: Unbound chart panel shows an empty default chart
- **WHEN** a panel with `type: "chart"` has no data bound (`typeId` is absent)
- **THEN** an empty chart with placeholder axes is displayed using the selected chart type (or line if unset)

#### Scenario: Chart panel with unknown chartType falls back to line
- **WHEN** a panel with `type: "chart"` has an unrecognised `appearance.chartType` value
- **THEN** a line chart is rendered without error

#### Scenario: Chart fills the panel card body
- **WHEN** a chart panel is rendered
- **THEN** the ECharts canvas fills 100% of the available card body height and width

#### Scenario: No console errors on mount
- **WHEN** a chart panel mounts
- **THEN** no JavaScript errors or warnings are emitted to the console

#### Scenario: No console errors on unmount
- **WHEN** a chart panel is removed from the grid (panel deleted or dashboard changed)
- **THEN** the ECharts instance is disposed cleanly with no console errors

### Requirement: Chart panel resizes with the grid panel
The ECharts instance MUST reflow to match the panel card dimensions whenever the panel is resized
on the dashboard grid.

#### Scenario: Chart resizes when panel is resized
- **WHEN** the user drags a chart panel's resize handle to a new size
- **THEN** the ECharts canvas updates its dimensions to fill the new panel size without overflow or blank space


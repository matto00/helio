## MODIFIED Requirements

### Requirement: Chart panel sizing
The chart panel (`ChartPanel`) SHALL be wrapped in a `<div className="panel-content panel-content--chart">`
element inside `PanelContent`. The wrapper SHALL carry `flex: 1` and `min-height: 0` from the base
`.panel-content` rule and SHALL override padding to `0` via `.panel-content--chart { padding: 0; }`.
The inner `ReactECharts` element SHALL use `style={{ height: "100%", width: "100%" }}` and
`autoResize: true`. The chart SHALL fill the full content area allocated by the parent panel card
after header and footer are subtracted. Internal ECharts padding and label font sizes are managed by
ECharts defaults and appearance overrides, not by CSS.

#### Scenario: Chart panel fill at any height
- **WHEN** a chart panel is resized via the grid
- **THEN** the ECharts canvas redraws to fill the new content dimensions within one render cycle

#### Scenario: Chart panel wrapper has correct CSS properties
- **WHEN** a chart panel is rendered in the dashboard grid
- **THEN** the `.panel-content--chart` element SHALL have `flex: 1`, `min-height: 0`, and `padding: 0`
- **AND** the ECharts canvas child SHALL have `height: 100%` and `width: 100%`

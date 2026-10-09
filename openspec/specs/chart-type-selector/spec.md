# chart-type-selector Specification

## Purpose
Controls the chart rendering type (bar, line, pie, scatter) for chart panels. The chart type is chosen on the bound Output (`config.chartType`); a chart type stored on the panel's own appearance still takes precedence, and the effective type resolves panel, then Output, then `line`. The panel detail modal shows no chart type selector.

## Requirements

### Requirement: Panel detail modal does not expose a chart type selector
The panel detail modal MUST NOT display a chart type selector for any panel type. A chart panel's chart type is
chosen on its bound Output's configuration; a panel's previously stored `appearance.chart.chartType` (set through the
appearance write API) still takes precedence when the panel renders.

#### Scenario: No chart type selector for a chart panel
- **WHEN** an output panel bound to a chart Output is opened in the panel detail modal
- **THEN** no chart type control (no "Chart type" label and no chart-type radio options) is present

### Requirement: Panel detail modal never seeds an implicit chart type
The panel detail modal's chart-appearance edit state MUST carry a `chartType` only when the panel's stored
`appearance.chart.chartType` is set, and then MUST carry that stored value unchanged. When the panel stores no
`chartType`, the edit state MUST leave `chartType` unset (never defaulting it to `line` or any other value), so the
effective type keeps resolving panel, then the bound Output's `config.chartType`, then `line`. Saving the modal MUST NOT
send a `chartType` the panel did not already store.

#### Scenario: Panel without a stored chart type bound to a bar Output
- **GIVEN** an output panel with no stored `appearance.chart.chartType`, bound to an Output whose `config.chartType` is `bar`
- **WHEN** the panel detail modal is opened
- **THEN** the modal's initial chart-appearance edit state has no `chartType`
- **AND WHEN** the user edits the title and saves
- **THEN** the save payload contains no `appearance.chart` and no `chartType`

#### Scenario: Stored panel chart type is preserved
- **GIVEN** a panel whose stored `appearance.chart.chartType` is `pie`
- **WHEN** the panel detail modal is opened
- **THEN** the modal's initial chart-appearance edit state has `chartType` `pie`

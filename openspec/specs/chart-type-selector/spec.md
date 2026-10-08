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

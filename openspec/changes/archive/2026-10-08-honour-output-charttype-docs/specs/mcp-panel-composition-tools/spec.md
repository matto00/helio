## ADDED Requirements

### Requirement: MCP placement and appearance tools state where a chart's type is resolved
The helio-mcp `place_outputs` and `update_panel_appearance` tool descriptions SHALL state the chart-type precedence
the dashboard renders with: the panel's own `appearance.chart.chartType` when set, else the bound Output's
`config.chartType`, else `line`. `place_outputs` SHALL say that a placement stores no chart type (so the Output's type
renders) and name `update_output` (Output default) and `update_panel_appearance` (per-panel override) as the two ways to
change it. `update_panel_appearance` SHALL say that clearing `chartType` with `null` renders the Output's type (else
line), not a fixed line default.

#### Scenario: place_outputs description names the precedence
- **WHEN** an MCP client lists tools and reads `place_outputs`'s description
- **THEN** it states that the rendered chart type is the panel appearance `chartType` if set, else the Output's
  `config.chartType`, else line
- **AND** it no longer claims chartType exists only on the Output

#### Scenario: update_panel_appearance description describes clearing chartType accurately
- **WHEN** an MCP client reads `update_panel_appearance`'s description
- **THEN** it states that `{chart: {chartType: null}}` makes the panel render its Output's `config.chartType` (else
  line)

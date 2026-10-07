## MODIFIED Requirements

### Requirement: Panel appearance chart merges partially
A payload `appearance.chart` object MUST merge over the panel's stored `chart` (or
`ChartAppearance.Default` when the panel has no stored `chart`) field-by-field. A payload chart
carrying only a subset of `seriesColors`/`legend`/`tooltip`/`axisLabels`/`chartType` MUST be
accepted and MUST leave every unlisted chart field at its stored (or default) value. Each provided
chart field replaces the stored field's value wholesale (no merge inside `legend`/`tooltip`/
`axisLabels` themselves).

#### Scenario: Partial chart payload sets only the provided field
- **GIVEN** an existing chart panel with a stored `chart` carrying non-default `seriesColors`,
  `legend`, `tooltip`, and `axisLabels`
- **WHEN** a client PATCHes the panel with `{"appearance": {"chart": {"chartType": "bar"}}}`
- **THEN** the request returns 200 (not 400)
- **AND** the panel's stored `chart.chartType` becomes `"bar"`
- **AND** `seriesColors`, `legend`, `tooltip`, and `axisLabels` remain at their stored values

#### Scenario: Partial chart payload on a panel with no stored chart merges over the chart default
- **GIVEN** an existing panel with no stored `appearance.chart`
- **WHEN** a client PATCHes the panel with `{"appearance": {"chart": {"chartType": "pie"}}}`
- **THEN** the panel's stored `chart` becomes `ChartAppearance.Default` with `chartType` overridden
  to `"pie"`

#### Scenario: Explicit null on chartType within a chart patch clears it (does not reset to the line default)
- **GIVEN** an existing chart panel whose stored `chart.chartType` is `"bar"`
- **WHEN** a client PATCHes the panel with `{"appearance": {"chart": {"chartType": null}}}`
- **THEN** the panel's stored `chart.chartType` becomes absent (`None`), so the panel renders
  the bound Output's `config.chartType` (else line) — **not** reset to `ChartAppearance.Default.chartType`
  (`"line"`), which is the one field-level exception to the general "null resets to Default" rule

## MODIFIED Requirements

### Requirement: Panel appearance settings are persisted through resource updates
The backend MUST merge supported panel appearance settings into the panel's stored `appearance`
so they are returned on subsequent reads. A field absent from the update payload MUST preserve the
panel's currently-stored value for that field rather than reverting to a default. An explicit
`null` for a field MUST reset that field to `PanelAppearance.Default`'s corresponding value. This
merge semantics applies identically to `PATCH /api/panels/:id` and `POST /api/panels/updateBatch`.

#### Scenario: Panel appearance is updated
- **GIVEN** an existing panel
- **WHEN** a client submits an update that changes the panel `appearance`
- **THEN** the panel stores the updated background, color, and transparency settings
- **AND** a later fetch for that panel returns the saved `appearance`

#### Scenario: Omitted top-level appearance field preserves the stored value
- **GIVEN** an existing chart panel whose stored `appearance.chart.chartType` is `"bar"`
- **WHEN** a client PATCHes the panel with `{"appearance": {"background": "#0a0"}}` (no `chart` key)
- **THEN** the request returns 200
- **AND** the panel's stored `background` becomes `"#0a0"`
- **AND** the panel's stored `chart.chartType` remains `"bar"`
- **AND** every other stored chart sub-field (`seriesColors`, `legend`, `tooltip`, `axisLabels`) is
  unchanged

#### Scenario: Sequential PATCHes each preserve the other's prior change
- **GIVEN** an existing panel with default appearance
- **WHEN** a client PATCHes `{"appearance": {"chart": {"chartType": "bar"}}}`
- **AND** the client then PATCHes `{"appearance": {"background": "#123456"}}`
- **THEN** the panel's stored `appearance.chart.chartType` is still `"bar"` after the second PATCH
- **AND** the panel's stored `appearance.background` is `"#123456"`

#### Scenario: Explicit null resets a field to its default
- **GIVEN** an existing panel whose stored `appearance.background` is `"#0a0"`
- **WHEN** a client PATCHes the panel with `{"appearance": {"background": null}}`
- **THEN** the panel's stored `appearance.background` becomes `"transparent"` (`PanelAppearance.Default`)

#### Scenario: Explicit null on chart clears the chart sub-object
- **GIVEN** an existing chart panel with a stored `appearance.chart`
- **WHEN** a client PATCHes the panel with `{"appearance": {"chart": null}}`
- **THEN** the panel's stored `appearance.chart` becomes absent (`None`)

#### Scenario: A top-level explicit null on the whole appearance field is a no-op, not a wipe
- **GIVEN** an existing panel with a stored non-default `appearance`
- **WHEN** a client PATCHes the panel with `{"appearance": null}`
- **THEN** the request returns 200
- **AND** the panel's stored `appearance` is unchanged (identical to before the request)

#### Scenario: A full appearance payload merges to the same result as a full replace
- **GIVEN** an existing panel with any stored appearance
- **WHEN** a client PATCHes with a complete `PanelAppearance` object (every field present, no
  `null`s), as every current caller (frontend, helio-news, helio-mcp) sends today
- **THEN** the panel's stored appearance equals the submitted object field-for-field — identical to
  today's replace behavior

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
- **THEN** the panel's stored `chart.chartType` becomes absent (`None`), matching today's
  absent-chartType-renders-as-line fallback — **not** reset to `ChartAppearance.Default.chartType`
  (`"line"`), which is the one field-level exception to the general "null resets to Default" rule

## ADDED Requirements

### Requirement: Batch appearance updates use the same merge semantics as the single-item PATCH
`POST /api/panels/updateBatch` MUST merge each item's `appearance` payload using the identical
absent-vs-null and partial-`chart` semantics as `PATCH /api/panels/:id`, so the two write paths
cannot diverge.

#### Scenario: Batch appearance update preserves an omitted field
- **GIVEN** a panel whose stored `appearance.color` is `"#ffffff"`
- **WHEN** a client sends `POST /api/panels/updateBatch` with
  `fields: ["appearance"], panels: [{ id: "p1", appearance: { background: "#000000" } }]`
- **THEN** the panel's stored `background` becomes `"#000000"`
- **AND** the panel's stored `color` remains `"#ffffff"`

#### Scenario: Batch appearance update accepts a partial chart payload
- **GIVEN** a panel with a stored `chart.chartType` of `"line"` and non-default `legend`
- **WHEN** a client sends `POST /api/panels/updateBatch` with
  `fields: ["appearance"], panels: [{ id: "p1", appearance: { chart: { chartType: "scatter" } } }]`
- **THEN** the request returns 200
- **AND** the panel's stored `chart.chartType` becomes `"scatter"`
- **AND** the panel's stored `chart.legend` remains unchanged

# panel-appearance-settings Specification

## Purpose
Defines the requirements for panel-level visual appearance settings, including how appearance data is
represented in API responses, persisted through updates, and validated against the schema.
## Requirements
### Requirement: Panel resources expose nested appearance settings
Panel resources MUST include a nested `appearance` object that carries panel-level visual customization settings.

#### Scenario: Panel response includes appearance object
- **WHEN** a client fetches panel resources for a dashboard
- **THEN** each panel response includes an `appearance` object
- **AND** the `appearance` object is represented separately from `meta`
- **AND** the `appearance` object includes the supported panel background, color, and transparency settings

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

### Requirement: Panel appearance contract is validated
The panel schema MUST validate the nested appearance object shape.

#### Scenario: Panel schema defines appearance
- **WHEN** panel payloads are validated against the schema
- **THEN** the schema requires an `appearance` object
- **AND** the appearance object validates the supported panel appearance fields

### Requirement: Panel appearance chartType is validated
The panel schema MUST validate the optional `chartType` field within the appearance object.

#### Scenario: Panel schema validates chartType values
- **WHEN** panel payloads are validated against the schema
- **THEN** the appearance object accepts an optional `chartType` field
- **AND** `chartType` MUST be one of: line, bar, pie, scatter when present

#### Scenario: Panel schema rejects unknown chartType values
- **WHEN** a panel appearance payload contains a `chartType` value not in the allowed set
- **THEN** schema validation fails with an error indicating the invalid value

#### Scenario: Panel schema accepts payload without chartType
- **WHEN** a panel appearance payload omits the `chartType` field
- **THEN** schema validation succeeds and the panel is stored without a chartType

### Requirement: Panel transparency slider produces a smooth and well-distributed alpha range
The panel transparency slider (0–100) SHALL map to an alpha range that produces a perceptible
and smoothly-distributed change in panel surface opacity across the full slider travel.

#### Scenario: Panel surface is nearly opaque at zero transparency
- **WHEN** a panel's transparency is set to 0
- **THEN** the `buildPanelSurface` function returns an rgba value with an alpha at or near 0.9

#### Scenario: Panel surface is significantly transparent at maximum transparency
- **WHEN** a panel's transparency is set to 100
- **THEN** the `buildPanelSurface` function returns an rgba value with an alpha at or near 0.18

#### Scenario: Panel transparency alpha decreases monotonically across the slider range
- **WHEN** transparency increases from 0 to 100
- **THEN** the resulting surface alpha decreases monotonically with no discontinuities

### Requirement: Appearance writes validate chart type

The system MUST reject an `appearance.chart.chartType` outside the allowed set (`bar`, `line`,
`pie`, `scatter`) with a 400 whose message names the valid values, on all three panel appearance
write paths: `POST /api/panels` (optional create-time `appearance`), `PATCH /api/panels/:id`, and
`POST /api/panels/updateBatch` (the path the live edit UI uses). Batch validation MUST run before
the transactional write so an invalid item rejects the whole batch with no partial write. An absent
`chartType` SHALL remain valid (renderers fall back to line).

#### Scenario: PATCH with invalid chartType is rejected

- **WHEN** a client PATCHes a panel with `appearance.chart.chartType: "donut"`
- **THEN** the request is rejected with a 400 naming the valid values
- **AND** the stored appearance is unchanged

#### Scenario: PATCH with valid chartType persists

- **WHEN** a client PATCHes a panel with `appearance.chart.chartType: "scatter"`
- **THEN** the stored appearance carries `chart.chartType: "scatter"`

#### Scenario: Create with invalid chartType is rejected

- **WHEN** a create request includes `appearance.chart.chartType: "donut"`
- **THEN** the request is rejected with a 400 naming the valid values

#### Scenario: Batch update with invalid chartType is rejected with no partial write

- **WHEN** a `POST /api/panels/updateBatch` request contains one item with
  `appearance.chart.chartType: "donut"` alongside otherwise-valid items
- **THEN** the request is rejected with a 400 naming the valid values
- **AND** no item in the batch is persisted

#### Scenario: Batch update with valid chartType persists

- **WHEN** a batch item carries `appearance.chart.chartType: "pie"`
- **THEN** the stored appearance for that panel carries `chart.chartType: "pie"`

### Requirement: Untouched appearance sentinels survive the edit-modal save

The panel edit modal MUST preserve an appearance sentinel value (`background: "transparent"`,
`color: "inherit"`) through a save when the user did not edit that specific field. Because the
color controls can only display a resolved fallback hex, the modal SHALL restore the original
sentinel in the saved appearance payload for any color field the user left untouched, and MUST
persist an explicitly chosen hex color unchanged for any field the user edited.

#### Scenario: Untouched transparent background stays transparent

- **GIVEN** a panel whose stored `appearance.background` is `"transparent"`
- **WHEN** the user opens the edit modal, changes only an unrelated field, and saves
- **THEN** the saved `appearance.background` is still `"transparent"`
- **AND** it is not replaced with the color input's fallback hex

#### Scenario: Untouched inherit text color stays inherit

- **GIVEN** a panel whose stored `appearance.color` is `"inherit"`
- **WHEN** the user opens the edit modal, changes only an unrelated field, and saves
- **THEN** the saved `appearance.color` is still `"inherit"`

#### Scenario: Explicitly chosen color persists as hex

- **GIVEN** a panel whose stored `appearance.background` is `"transparent"`
- **WHEN** the user picks a background color in the edit modal and saves
- **THEN** the saved `appearance.background` is the chosen hex value, not `"transparent"`

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


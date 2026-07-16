# chart-type-display-config — Delta

## ADDED Requirements

### Requirement: ChartPanelConfig carries optional per-chart-type display options
`ChartPanelConfig` SHALL accept an optional `chartOptions` object keyed by chart type
(`line`, `bar`, `pie`, `scatter`), each key optional and independently shaped:
- `line`: `smooth?: boolean`, `showPoints?: boolean`, `areaFill?: boolean`
- `bar`: `orientation?: "vertical" | "horizontal"`, `stacking?: "none" | "stacked" | "normalized"`,
  `barGapPct?: number` (0–100)
- `pie`: `donutHolePct?: number` (0–90), `showPercentLabels?: boolean`
- `scatter`: `sizeField?: string`, `colorField?: string` (data-column keys of the bound DataType)

The shape MUST be declared in `schemas/panel.schema.json` under `$defs.ChartConfig` and mirrored in the
frontend `ChartPanelConfig` type and the backend `ChartPanelConfig` domain class.

#### Scenario: Config round-trips through create and GET
- **WHEN** a chart panel is created or patched with `config.chartOptions` containing valid per-type entries
- **THEN** a subsequent panel fetch returns the same `chartOptions` object

#### Scenario: Absent chartOptions means current behavior
- **WHEN** a chart panel's config carries no `chartOptions` key (absent, not null)
- **THEN** the panel decodes, persists, and renders exactly as before this change
- **AND** no `chartOptions` key is invented on the wire response

### Requirement: chartOptions persists in a dedicated nullable column
The backend SHALL persist `chartOptions` in a single nullable `chart_options` JSONB column on `panels`
(Flyway migration), written and read only by the chart arm of the row mapper. Existing rows require zero
data migration: `NULL` decodes to an absent `chartOptions`.

#### Scenario: Existing chart panels are unaffected
- **WHEN** a chart panel row created before this change (chart_options IS NULL) is read
- **THEN** it decodes successfully with `chartOptions` absent and renders with prior defaults

#### Scenario: Dashboard duplication preserves chartOptions
- **WHEN** a dashboard containing a chart panel with `chartOptions` is duplicated
- **THEN** the duplicated panel carries the same `chartOptions`

### Requirement: chartOptions values are validated with allow-lists and clamps
PATCH/create inputs MUST validate: `orientation` and `stacking` against their enumerated values,
`barGapPct` within 0–100, `donutHolePct` within 0–90. An invalid enum or out-of-range number SHALL be
rejected with HTTP 400 and a message naming the offending field. `null` for `chartOptions` clears the
stored value; an absent key leaves it unchanged (spray-json omits `None` — absence MUST be tested
explicitly).

#### Scenario: Invalid stacking value is rejected
- **WHEN** a PATCH sets `config.chartOptions.bar.stacking` to `"sideways"`
- **THEN** the response is 400 and the stored config is unchanged

#### Scenario: Absent key on PATCH leaves stored options unchanged
- **GIVEN** a chart panel with stored `chartOptions`
- **WHEN** a config PATCH arrives without a `chartOptions` key
- **THEN** the stored `chartOptions` are unchanged after the PATCH

#### Scenario: Null clears stored options
- **WHEN** a PATCH sets `config.chartOptions` to `null`
- **THEN** the stored value is cleared and subsequent fetches return config without `chartOptions`

### Requirement: Switching chart type preserves all config
Because `chartOptions` is keyed per type, changing `appearance.chart.chartType` MUST NOT modify or
discard any `chartOptions` entry, the data binding (`dataTypeId`, `fieldMapping`, `aggregation`),
panel appearance, or refresh interval.

#### Scenario: Type round-trip restores prior type's options
- **GIVEN** a chart panel with `chartOptions.bar` configured and chartType `bar`
- **WHEN** the user switches the chart type to `pie`, saves, then switches back to `bar` and saves
- **THEN** the panel renders with the originally configured bar options
- **AND** binding, appearance, and refresh interval are unchanged throughout

# panel-creation-type-config — delta (HEL-305)

## ADDED Requirements

### Requirement: Step-3 type-specific config values take effect on the created panel

Values entered in the creation modal's type-specific config fields MUST be carried into the
`POST /api/panels` create payload and be reflected by the created panel on its first render — no
follow-up edit may be required for a collected value to apply.

- Chart: a selected `chartType` MUST be carried as `appearance.chart.chartType` on the create
  payload (composed over the shared default panel/chart appearance) and the created panel MUST
  render as that chart type on first render. When no chart type is selected, the payload MUST omit
  the `appearance` key entirely and the panel defaults to line as today.
- Metric: a non-empty `valueLabel` MUST be carried as `config.label`, and a non-empty `unit` as
  `config.unit`; empty values MUST be omitted from the config.
- Image: `imageUrl` continues to be carried as `config.imageUrl` (existing behavior, unchanged).

#### Scenario: Chart created as bar renders as bar on first render

- **WHEN** the user selects the Chart type, picks "Bar" in step 3, and completes creation
- **THEN** the create request carries `appearance.chart.chartType: "bar"`
- **AND** the created panel renders as a bar chart on first render, without any follow-up edit

#### Scenario: Chart created without a type selection omits appearance

- **WHEN** the user selects the Chart type and leaves the chart-type selector unset
- **THEN** the create request omits the `appearance` key
- **AND** the created panel renders with the default (line) chart type

#### Scenario: Metric value label and unit are seeded into config

- **WHEN** the user creates a Metric panel with value label "Revenue" and unit "USD"
- **THEN** the create request carries `config.label: "Revenue"` and `config.unit: "USD"`
- **AND** the created panel displays that label and unit on first render

#### Scenario: Empty metric fields are omitted

- **WHEN** the user creates a Metric panel leaving value label and unit blank
- **THEN** the create request's `config` carries neither `label` nor `unit`

### Requirement: Create endpoint accepts an optional appearance

`POST /api/panels` MUST accept an optional `appearance` field (same shape as the PATCH appearance,
per `schemas/create-panel-request.schema.json`). When present it SHALL be validated (including
`chartType` against the allowed set) and stored on the created panel in place of the default
appearance; when absent, the default appearance SHALL be applied exactly as before.

#### Scenario: Create with appearance persists it

- **WHEN** a create request includes a valid `appearance` with `chart.chartType: "pie"`
- **THEN** the created panel's stored appearance carries `chart.chartType: "pie"`

#### Scenario: Create without appearance keeps the default

- **WHEN** a create request omits `appearance`
- **THEN** the created panel's stored appearance equals the default panel appearance

#### Scenario: Invalid chartType in create appearance is rejected

- **WHEN** a create request includes `appearance.chart.chartType: "donut"`
- **THEN** the request is rejected with a 400 and a message naming the valid values

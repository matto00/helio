# panel-creation-type-config Specification

## Purpose
TBD - created by archiving change panel-creation-initial-config. Update Purpose after archive.
## Requirements
### Requirement: Step 3 of the creation modal shows type-specific config fields
The panel creation modal step 3 (title/config step) MUST render optional type-specific configuration
fields below the title input, determined by the panel type selected in step 1. All fields SHALL be
optional — the user MAY leave them blank and configure later via the detail modal. `divider` is not a
selectable type in step 1 (HEL-249) and therefore has no step-3 config fields.

#### Scenario: Metric panel shows value label and unit inputs
- **WHEN** the user has selected the Metric panel type and reaches step 3
- **THEN** a "Value label" text input is shown below the title field
- **AND** a "Unit" text input is shown below the value label input
- **AND** both inputs are optional (no required indicator)

#### Scenario: Chart panel shows chart type selector
- **WHEN** the user has selected the Chart panel type and reaches step 3
- **THEN** a "Chart type" selector is shown below the title field
- **AND** the selector offers four options: Line, Bar, Pie, Scatter
- **AND** no option is pre-selected (field is optional)

#### Scenario: Image panel shows image URL input
- **WHEN** the user has selected the Image panel type and reaches step 3
- **THEN** an "Image URL" text input is shown below the title field
- **AND** the input is optional

#### Scenario: Text panel shows no additional fields
- **WHEN** the user has selected the Text panel type and reaches step 3
- **THEN** no additional configuration fields are shown beyond the title input

#### Scenario: Table panel shows no additional fields
- **WHEN** the user has selected the Table panel type and reaches step 3
- **THEN** no additional configuration fields are shown beyond the title input

#### Scenario: Markdown panel shows no additional fields
- **WHEN** the user has selected the Markdown panel type and reaches step 3
- **THEN** no additional configuration fields are shown beyond the title input

### Requirement: Type-specific config values are included in the creation payload
When the user submits the creation form, any type-specific config values entered in step 3 MUST be
included in the panel creation request so they take effect immediately without requiring a follow-up
edit via the detail modal.

#### Scenario: Metric config submitted with creation
- **GIVEN** the user has entered a value label and/or unit in step 3
- **WHEN** the user confirms panel creation
- **THEN** the creation payload includes the value label and/or unit under the metric config fields

#### Scenario: Chart type submitted with creation
- **GIVEN** the user has selected a chart type in step 3
- **WHEN** the user confirms panel creation
- **THEN** the creation payload includes the selected chart type

#### Scenario: Image URL submitted with creation
- **GIVEN** the user has entered an image URL in step 3
- **WHEN** the user confirms panel creation
- **THEN** the creation payload includes the image URL

#### Scenario: Empty optional fields are omitted from payload
- **GIVEN** the user leaves all type-specific config fields blank
- **WHEN** the user confirms panel creation
- **THEN** the creation payload does not include the optional config fields (or omits their values)
- **AND** the panel is created with backend-default values for those fields

### Requirement: Non-empty type-specific config fields mark the modal as dirty
If the user has entered any value in a type-specific config field, the modal MUST be treated as dirty
for the purpose of the discard-confirmation prompt.

#### Scenario: Config field entry triggers dirty state
- **GIVEN** the user reaches step 3 and enters a value in a type-specific config field
- **WHEN** the user attempts to close or dismiss the modal
- **THEN** the discard-confirmation prompt is shown

### Requirement: Type-specific config state resets on modal close
All type-specific config field values MUST be cleared when the modal closes, regardless of whether
a panel was created.

#### Scenario: Config fields reset after cancel
- **WHEN** the user cancels the creation modal after having entered config values
- **AND** reopens the modal
- **THEN** all type-specific config fields are empty

#### Scenario: Config fields reset after successful create
- **WHEN** the user creates a panel and the modal closes
- **AND** the user opens the modal again
- **THEN** all type-specific config fields are empty

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


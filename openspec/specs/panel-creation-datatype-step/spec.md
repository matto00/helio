# panel-creation-datatype-step Specification

## Purpose
TBD - created by archiving change panel-datatype-selection. Update Purpose after archive.
## Requirements
### Requirement: DataType picker step for data-bound panel types during creation
The modal SHALL present a DataType picker step after template selection when the selected panel type
is data-bound (metric, chart, text, table, collection). The picker SHALL list only DataTypes
referenced by at least one pipeline via `outputDataTypeId`. Non-data-bound types (markdown, image,
divider) SHALL skip this step and advance directly to the name-entry step.

#### Scenario: DataType step appears after template selection for metric type
- **WHEN** the user selects the "metric" type card and then selects a template
- **THEN** the DataType picker step is shown
- **AND** the name-entry step is not yet shown

#### Scenario: DataType step appears after template selection for chart type
- **WHEN** the user selects the "chart" type card and then selects a template
- **THEN** the DataType picker step is shown

#### Scenario: DataType step appears after template selection for text type
- **WHEN** the user selects the "text" type card and then selects a template
- **THEN** the DataType picker step is shown

#### Scenario: DataType step appears after template selection for table type
- **WHEN** the user selects the "table" type card and then selects a template
- **THEN** the DataType picker step is shown

#### Scenario: DataType step appears after template selection for collection type
- **WHEN** the user selects the "collection" type card and then selects a template
- **THEN** the DataType picker step is shown

#### Scenario: DataType step is skipped for markdown type
- **WHEN** the user selects the "markdown" type card and then selects a template
- **THEN** the name-entry step is shown immediately
- **AND** no DataType picker step is shown

#### Scenario: DataType step is skipped for image type
- **WHEN** the user selects the "image" type card and then selects a template
- **THEN** the name-entry step is shown immediately

#### Scenario: DataType step is skipped for divider type
- **WHEN** the user selects the "divider" type card and then selects a template
- **THEN** the name-entry step is shown immediately

### Requirement: DataType picker lists only registry-produced DataTypes
The DataType picker SHALL display only DataTypes whose `id` appears as the `outputDataTypeId` of at
least one pipeline. Each entry SHALL show the DataType name. If the pipelines list is not yet
loaded, the modal SHALL dispatch a fetch on step entry. When no registry DataTypes exist and both
slices have finished loading (`status === "succeeded"`), the empty state UI SHALL be shown in place
of the list (see `panel-creation-datatype-empty-state` spec). While either slice has status `loading`
or `idle`, neither the list nor the empty state SHALL be shown.

#### Scenario: Only pipeline-produced DataTypes are shown
- **WHEN** the DataType step is rendered
- **AND** two DataTypes exist but only one has a pipeline referencing it via outputDataTypeId
- **THEN** only the pipeline-referenced DataType is shown in the picker list

#### Scenario: No registry DataTypes shows empty state with pipeline link
- **WHEN** the DataType step is rendered
- **AND** both `pipelines.status` and `dataTypes.status` are `succeeded`
- **AND** no DataTypes are referenced by any pipeline
- **THEN** the empty state UI is shown with `data-testid="datatype-empty-state"`
- **AND** a link with `data-testid="datatype-empty-pipeline-link"` navigating to `/pipelines` is shown

#### Scenario: Empty state is not shown while slices are loading
- **WHEN** the DataType step is rendered
- **AND** `pipelines.status` is `loading`
- **THEN** neither the DataType list nor the empty state is shown

### Requirement: DataType selection is required before advancing to name-entry
The "Next" button on the DataType picker step SHALL be disabled until the user selects a DataType.
Clicking a DataType entry SHALL select it (highlighted). Clicking the selected entry again SHALL
deselect it.

#### Scenario: Next button is disabled when no DataType is selected
- **WHEN** the DataType step is shown and no DataType has been selected
- **THEN** the Next button is disabled

#### Scenario: Next button is enabled after DataType selection
- **WHEN** the user clicks a DataType entry in the picker
- **THEN** that DataType is highlighted as selected
- **AND** the Next button becomes enabled

#### Scenario: Clicking Next with a selected DataType advances to name-entry
- **WHEN** the user has selected a DataType and clicks Next
- **THEN** the name-entry step is shown

### Requirement: Back navigation from DataType step returns to template selection
The DataType picker step SHALL include a Back button. Clicking it SHALL return the user to the
template-select step and SHALL clear the currently selected DataType.

#### Scenario: Back from DataType step returns to template-select
- **WHEN** the user is on the DataType picker step and clicks Back
- **THEN** the template-select step is shown
- **AND** any DataType selection is cleared

### Requirement: Selected DataType ID is included in the dirty-state check
Selecting a DataType on the DataType step SHALL mark the modal as dirty, so that dismissing the
modal triggers the discard confirmation prompt.

#### Scenario: Modal is dirty after DataType selection
- **WHEN** the user selects a DataType on the DataType picker step
- **AND** attempts to close the modal
- **THEN** the discard confirmation prompt is shown

### Requirement: DataType step offers matching shapes for metric, chart, and table panel types
For panel types `metric`, `chart`, and `table` only, the DataType picker step SHALL additionally show
shape cards for the panel type's mapped shape ids (`metric` → `single-row`; `chart` → `time-series`,
`top-n`; `table` → `top-n`, `pivot-matrix`), sourced by filtering the live `GET /api/pipeline-shapes`
catalog response to that id set — never a separately hardcoded shape definition. Other data-bound types
(`text`, `markdown`, `collection`, `timeline`) SHALL show only the existing DataType list, unchanged.

#### Scenario: Metric panel creation offers the single-row shape
- **WHEN** the DataType step is shown for a metric panel
- **THEN** a shape card for `single-row` is shown alongside the existing DataType list

#### Scenario: Chart panel creation offers time-series and top-n shapes
- **WHEN** the DataType step is shown for a chart panel
- **THEN** shape cards for `time-series` and `top-n` are shown alongside the existing DataType list

#### Scenario: Table panel creation offers top-n and pivot-matrix shapes
- **WHEN** the DataType step is shown for a table panel
- **THEN** shape cards for `top-n` and `pivot-matrix` are shown alongside the existing DataType list

#### Scenario: Text panel creation shows no shape cards
- **WHEN** the DataType step is shown for a text panel
- **THEN** no shape cards are shown
- **AND** only the existing DataType list behavior applies

### Requirement: Selecting a shape card diverges from the existing-DataType selection path
Clicking a shape card SHALL NOT select an existing DataType and SHALL NOT enable the existing step's
"Next" button; it SHALL instead advance the modal to the shape-instantiate step (see
`panel-creation-shape-step`).

#### Scenario: Selecting a shape card does not select a DataType
- **WHEN** the user clicks a shape card on the DataType step
- **THEN** no existing DataType entry becomes selected
- **AND** the modal advances to the shape-instantiate step


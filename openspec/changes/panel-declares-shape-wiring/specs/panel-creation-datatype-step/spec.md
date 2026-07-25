## ADDED Requirements

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

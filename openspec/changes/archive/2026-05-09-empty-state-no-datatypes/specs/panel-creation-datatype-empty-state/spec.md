## ADDED Requirements

### Requirement: Empty state with pipeline CTA when no registry DataTypes exist
The system SHALL display an empty state UI in place of the DataType list when the DataType picker
step is shown and no pipeline-produced DataTypes are available. The empty state SHALL include
explanatory copy and a navigational link to the Pipelines page (`/pipelines`). The Next button
SHALL remain disabled while the empty state is visible.

#### Scenario: Empty state renders when no pipeline DataTypes exist
- **WHEN** the user reaches the DataType picker step for a data-bound panel type
- **AND** no DataTypes are referenced as `outputDataTypeId` by any pipeline
- **THEN** the empty state container is shown with `data-testid="datatype-empty-state"`
- **AND** the DataType list is not shown

#### Scenario: Empty state includes a link to the Pipelines page
- **WHEN** the empty state is visible
- **THEN** a link with `data-testid="datatype-empty-pipeline-link"` is rendered
- **AND** the link navigates to `/pipelines`

#### Scenario: Next button is disabled during empty state
- **WHEN** the empty state is visible
- **AND** no DataType has been selected
- **THEN** the Next button is disabled

#### Scenario: Empty state is NOT shown when registry DataTypes exist
- **WHEN** the DataType picker step is shown
- **AND** at least one DataType is referenced by a pipeline
- **THEN** the DataType list is shown
- **AND** the empty state container is not present

### Requirement: Empty state is not shown while pipelines or DataTypes are loading
The system SHALL NOT display the empty state while either the pipelines slice or the dataTypes slice
has status `loading` or `idle`. A loading indicator or blank state SHALL be shown instead.

#### Scenario: Empty state hidden during loading
- **WHEN** the DataType picker step is shown
- **AND** `pipelines.status` is `loading`
- **THEN** the empty state container is not visible

#### Scenario: Empty state hidden before fetch completes
- **WHEN** the DataType picker step is shown
- **AND** `dataTypes.status` is `idle`
- **THEN** the empty state container is not visible

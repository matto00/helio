## MODIFIED Requirements

### Requirement: PipelinesPage shows empty state when no pipelines exist
When no pipelines exist, `PipelinesPage` SHALL render an empty state containing a "Create pipeline"
button. Clicking the button SHALL open the `CreatePipelineModal`.

#### Scenario: Empty state is shown with no pipelines
- **WHEN** `GET /api/pipelines` returns an empty array
- **THEN** an empty state message is displayed with a "Create pipeline" button visible

#### Scenario: Create pipeline button opens modal from empty state
- **WHEN** the user clicks "Create pipeline" in the empty state
- **THEN** the `CreatePipelineModal` opens

## ADDED Requirements

### Requirement: PipelineListTable header contains a Create pipeline button
When pipelines exist, a "Create pipeline" button SHALL be displayed in a toolbar above the
`PipelineListTable`. Clicking the button SHALL open the `CreatePipelineModal`.

#### Scenario: Create pipeline button is visible in non-empty list
- **WHEN** `GET /api/pipelines` returns one or more pipelines
- **THEN** a "Create pipeline" button is visible above the pipeline table

#### Scenario: Create pipeline button opens modal from non-empty state
- **WHEN** the user clicks "Create pipeline" above the pipeline list
- **THEN** the `CreatePipelineModal` opens

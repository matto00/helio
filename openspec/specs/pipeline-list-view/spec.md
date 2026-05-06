# pipeline-list-view Specification

## Purpose
TBD - created by archiving change add-data-pipelines-list-view. Update Purpose after archive.
## Requirements
### Requirement: PipelinesPage fetches and displays pipeline list
`PipelinesPage` SHALL dispatch `fetchPipelines` on mount. When pipelines are loaded, a table or list SHALL render one row per pipeline showing: name, source data source name, output DataType name, last-run status, and last-run timestamp.

#### Scenario: Pipeline list renders with data
- **WHEN** `GET /api/pipelines` returns one or more pipelines
- **THEN** each pipeline is rendered with its name, source data source name, output DataType name, last-run status, and last-run timestamp visible

#### Scenario: Last-run status shows "succeeded"
- **WHEN** a pipeline has `lastRunStatus: "succeeded"`
- **THEN** the row displays a "Succeeded" status indicator

#### Scenario: Last-run status shows "failed"
- **WHEN** a pipeline has `lastRunStatus: "failed"`
- **THEN** the row displays a "Failed" status indicator

#### Scenario: Last-run status shows "never run"
- **WHEN** a pipeline has `lastRunStatus: null`
- **THEN** the row displays a "Never run" label and no timestamp

#### Scenario: Last-run timestamp is shown when present
- **WHEN** a pipeline has a non-null `lastRunAt` value
- **THEN** a human-readable timestamp is displayed in the last-run column

### Requirement: PipelinesPage shows empty state when no pipelines exist
When no pipelines exist, `PipelinesPage` SHALL render an empty state containing a "Create pipeline" button.

#### Scenario: Empty state is shown with no pipelines
- **WHEN** `GET /api/pipelines` returns an empty array
- **THEN** an empty state message is displayed with a "Create pipeline" button visible

#### Scenario: Create pipeline button is present in empty state
- **WHEN** the empty state is visible
- **THEN** a button labelled "Create pipeline" is rendered (the button may be a non-functional placeholder)

### Requirement: PipelinesPage handles loading and error states
`PipelinesPage` SHALL display a loading indicator while the pipeline fetch is in progress, and an error message if the fetch fails.

#### Scenario: Loading state is shown during fetch
- **WHEN** `fetchPipelines` is pending
- **THEN** a loading indicator is visible

#### Scenario: Error state is shown on fetch failure
- **WHEN** `GET /api/pipelines` returns a non-2xx response
- **THEN** an error message is displayed


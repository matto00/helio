## MODIFIED Requirements

### Requirement: PipelinesPage fetches and displays pipeline list
`PipelinesPage` SHALL dispatch `fetchPipelines` on mount. When pipelines are loaded, a table or
list SHALL render one row per pipeline showing: name, source data source name, output DataType name,
last-run status, last-run timestamp (relative format, e.g. "2 hours ago"), and last-run row count.

#### Scenario: Pipeline list renders with data
- **WHEN** `GET /api/pipelines` returns one or more pipelines
- **THEN** each pipeline is rendered with its name, source data source name, output DataType name,
  last-run status, last-run timestamp, and last-run row count visible

#### Scenario: Last-run status shows "succeeded"
- **WHEN** a pipeline has `lastRunStatus: "succeeded"`
- **THEN** the row displays a "Succeeded" status indicator

#### Scenario: Last-run status shows "failed"
- **WHEN** a pipeline has `lastRunStatus: "failed"`
- **THEN** the row displays a "Failed" status indicator

#### Scenario: Last-run status shows "Never run" when pipeline has no committed run
- **WHEN** a pipeline has `lastRunStatus: null`
- **THEN** the row displays a "Never run" label and no timestamp or row count

#### Scenario: Last-run timestamp is shown in relative format when present
- **WHEN** a pipeline has a non-null `lastRunAt` value
- **THEN** a human-readable relative timestamp (e.g. "3 hours ago", "2 days ago") is shown

#### Scenario: Row count is shown when present
- **WHEN** a pipeline has a non-null `lastRunRowCount`
- **THEN** the value is displayed with locale-formatted number (e.g. "1,234 rows")

## ADDED Requirements

### Requirement: PipelineListTable renders a Rows Written column
`PipelineListTable` SHALL include a "Rows Written" column after "Last Run At". When
`lastRunRowCount` is non-null the cell SHALL display the count formatted with locale separators
followed by " rows". When `lastRunRowCount` is null the cell SHALL render an em-dash.

#### Scenario: Row count column renders formatted value
- **WHEN** a pipeline summary has `lastRunRowCount: 1234`
- **THEN** the cell displays "1,234 rows"

#### Scenario: Row count column renders dash for never-run pipeline
- **WHEN** a pipeline summary has `lastRunRowCount: null`
- **THEN** the cell displays an em-dash placeholder

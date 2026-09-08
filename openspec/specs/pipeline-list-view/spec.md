# pipeline-list-view Specification

## Purpose
TBD - created by archiving change add-data-pipelines-list-view. Update Purpose after archive.
## Requirements
### Requirement: PipelinesPage fetches and displays pipeline list
`PipelinesPage` SHALL dispatch `fetchPipelines` on mount. When pipelines are loaded,
`PipelineListTable` SHALL render one row per pipeline showing: name, a "Sources" cell naming every
one of that pipeline's `roots` (not just the first), a "Status" (last-run status), a "Last run at"
timestamp (relative format, e.g. "2 hours ago"), a "Rows written" count, and an "Updated" column
(`updatedAt`, relative format). There is no per-pipeline output DataType (retired by HEL-903/904);
Outputs are a pipeline's many, not a singular bound type.

The table defaults to `updatedAt` descending (most-recently-edited first) on first paint, and
every column is independently sortable (`useSortedRows`/`SortableTh`, HEL-1022) — clicking a
header toggles `asc`/`desc` on that column.

The "Sources" cell renders every root's data source name, truncated to the first two names with a
"+N" suffix past that (the full list is available via the cell's tooltip); a pipeline with no
roots renders an em-dash.

#### Scenario: Pipeline list renders with data
- **WHEN** `GET /api/pipelines` returns one or more pipelines
- **THEN** each pipeline is rendered with its name, every root's source name in the Sources cell,
  last-run status, last-run timestamp, last-run row count, and an "Updated" relative timestamp
  visible

#### Scenario: List defaults to most-recently-updated first
- **WHEN** `GET /api/pipelines` returns pipelines with different `updatedAt` values
- **THEN** on first render the rows are ordered by `updatedAt` descending

#### Scenario: Sources cell shows every root, truncated past two
- **WHEN** a pipeline has three roots
- **THEN** the Sources cell shows the first two root names followed by "+1", and the cell's
  tooltip lists all three names

#### Scenario: Clicking a column header sorts by that column
- **WHEN** the user clicks the "Name" column header
- **THEN** the rows re-order by pipeline name ascending, and clicking it again reverses to
  descending

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

### Requirement: PipelinesPage shows empty state when no pipelines exist
When no pipelines exist, `PipelinesPage` SHALL render an empty state containing a "Create pipeline"
button. Clicking the button SHALL open the `CreatePipelineModal`.

#### Scenario: Empty state is shown with no pipelines
- **WHEN** `GET /api/pipelines` returns an empty array
- **THEN** an empty state message is displayed with a "Create pipeline" button visible

#### Scenario: Create pipeline button opens modal from empty state
- **WHEN** the user clicks "Create pipeline" in the empty state
- **THEN** the `CreatePipelineModal` opens

### Requirement: PipelinesPage handles loading and error states
`PipelinesPage` SHALL display a loading indicator while the pipeline fetch is in progress, and an error message if the fetch fails.

#### Scenario: Loading state is shown during fetch
- **WHEN** `fetchPipelines` is pending
- **THEN** a loading indicator is visible

#### Scenario: Error state is shown on fetch failure
- **WHEN** `GET /api/pipelines` returns a non-2xx response
- **THEN** an error message is displayed

### Requirement: PipelineListTable header contains a Create pipeline button
When pipelines exist, a "Create pipeline" button SHALL be displayed in a toolbar above the
`PipelineListTable`. Clicking the button SHALL open the `CreatePipelineModal`.

#### Scenario: Create pipeline button is visible in non-empty list
- **WHEN** `GET /api/pipelines` returns one or more pipelines
- **THEN** a "Create pipeline" button is visible above the pipeline table

#### Scenario: Create pipeline button opens modal from non-empty state
- **WHEN** the user clicks "Create pipeline" above the pipeline list
- **THEN** the `CreatePipelineModal` opens

### Requirement: PipelineListTable renders a Rows Written column
`PipelineListTable` SHALL include a "Rows written" column after "Last run at". When
`lastRunRowCount` is non-null the cell SHALL display the count formatted with locale separators
followed by " rows". When `lastRunRowCount` is null the cell SHALL render an em-dash.

#### Scenario: Row count column renders formatted value
- **WHEN** a pipeline summary has `lastRunRowCount: 1234`
- **THEN** the cell displays "1,234 rows"

#### Scenario: Row count column renders dash for never-run pipeline
- **WHEN** a pipeline summary has `lastRunRowCount: null`
- **THEN** the cell displays an em-dash placeholder


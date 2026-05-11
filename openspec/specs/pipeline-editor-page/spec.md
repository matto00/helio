## Purpose
Defines the frontend pipeline editor page (`/pipelines/:id`), which provides a visual editor
for viewing and modifying pipeline transformation steps.
## Requirements
### Requirement: Pipeline detail page renders at /pipelines/:id
The frontend SHALL render a `PipelineDetailPage` component when the user navigates to `/pipelines/:id`. The page SHALL display three sections: source selector bar at the top, river view in the scrollable middle, and footer bar at the bottom.

#### Scenario: Route renders detail page
- **WHEN** the user navigates to `/pipelines/some-id`
- **THEN** `PipelineDetailPage` is rendered

### Requirement: Back navigation to pipeline list
The pipeline detail page SHALL provide a back navigation affordance that links to `/pipelines`.

#### Scenario: Back link is present and correct
- **WHEN** `PipelineDetailPage` is rendered
- **THEN** a link element pointing to `/pipelines` is visible on the page

### Requirement: Source selector bar loads from API
The source selector bar SHALL fetch data sources via the `fetchSources` thunk and render one chip per source. Each chip SHALL display the source name.

#### Scenario: Sources are rendered from API
- **WHEN** the API returns a list of data sources
- **THEN** a chip for each source is visible in the source selector bar

### Requirement: River view empty state
When no transformation steps have been added, the river view SHALL display an empty state message containing "Add your first transformation step".

#### Scenario: Empty state shown with no steps
- **WHEN** the pipeline detail page is first rendered (steps array is empty)
- **THEN** the text "Add your first transformation step" is visible

### Requirement: Adding a transformation step
The user SHALL be able to add a transformation step. After adding, the step SHALL appear in the river view and the empty state SHALL no longer be visible.

#### Scenario: Step appears after adding
- **WHEN** the user triggers the add-step action
- **THEN** a new step card appears in the river view

### Requirement: Removing a transformation step
The user SHALL be able to remove a transformation step from the river view. After removal, the step SHALL no longer appear in the list.

#### Scenario: Step removed after removal action
- **WHEN** the user removes an existing step
- **THEN** that step is no longer visible in the river view

### Requirement: Editable output name in footer
The footer bar SHALL display an output name field. The user SHALL be able to edit the output name inline.

#### Scenario: Output name is editable
- **WHEN** the user activates the output name field
- **THEN** an input element is rendered allowing the name to be changed

### Requirement: Run pipeline button shows placeholder
The "Run pipeline" button in the footer bar SHALL be visible. When clicked, it SHALL display a placeholder message indicating execution is not yet available.

#### Scenario: Run button shows placeholder on click
- **WHEN** the user clicks the "Run pipeline" button
- **THEN** a placeholder message is shown (e.g. via alert or inline toast)

### Requirement: Pipeline detail page shows loading state while fetching
`PipelineDetailPage` SHALL display a loading indicator while `fetchPipelineById` or
`fetchPipelineSteps` is in the `"loading"` state. The main content SHALL not be rendered
until data is available.

#### Scenario: Spinner visible during fetch
- **WHEN** `PipelineDetailPage` is mounted and the API call is pending
- **THEN** a loading indicator is visible and the pipeline content is not rendered

### Requirement: Pipeline detail page shows error state on fetch failure
`PipelineDetailPage` SHALL display an error message when `fetchPipelineById` fails,
rather than rendering the editor.

#### Scenario: Error message shown on pipeline load failure
- **WHEN** `fetchPipelineById` rejects
- **THEN** an error message is shown instead of the editor

### Requirement: Pipeline name is loaded from Redux state
`PipelineDetailPage` SHALL use `currentPipeline.name` from Redux (populated via `fetchPipelineById`)
as the initial value for the output name field, replacing the previous fallback to the URL id.

#### Scenario: Output name initialized from API response
- **WHEN** `fetchPipelineById` succeeds
- **THEN** the output name field is initialized with `currentPipeline.name`

### Requirement: PipelineDetailPage shows persistent last-run metadata bar
`PipelineDetailPage` SHALL render a metadata bar displaying the persisted last-run information from
`currentPipeline`: relative timestamp, row count (locale-formatted), and status badge. The bar
SHALL appear only when `currentPipeline.lastRunAt` is non-null. When `lastRunAt` is null the bar
SHALL be absent and no "Never run" placeholder is shown in the metadata area (the never-run state
is communicated in the list view).

#### Scenario: Metadata bar is visible when pipeline has run
- **WHEN** `currentPipeline.lastRunAt` is a non-null ISO-8601 string
- **THEN** a metadata bar is rendered showing the relative timestamp, row count, and status

#### Scenario: Metadata bar is absent when pipeline has never run
- **WHEN** `currentPipeline.lastRunAt` is null
- **THEN** no metadata bar element is rendered

#### Scenario: Metadata bar shows relative timestamp
- **WHEN** the metadata bar is rendered
- **THEN** the last-run time is displayed in relative format (e.g. "2 hours ago")

#### Scenario: Metadata bar shows row count
- **WHEN** `currentPipeline.lastRunRowCount` is non-null
- **THEN** the count is shown with locale formatting (e.g. "4,200 rows")

#### Scenario: Metadata bar shows status badge
- **WHEN** `currentPipeline.lastRunStatus` is "succeeded" or "failed"
- **THEN** the appropriate status badge is rendered in the metadata bar


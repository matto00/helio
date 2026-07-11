## Purpose
Defines the frontend pipeline editor page (`/pipelines/:id`), which provides a visual editor
for viewing and modifying pipeline transformation steps.
## Requirements
### Requirement: Pipeline detail page renders at /pipelines/:id
The frontend SHALL render a `PipelineDetailPage` component when the user navigates to `/pipelines/:id`. The page SHALL display four sections: a read-only bound-source bar, a read-only bound-type bar, river view in the scrollable middle, and footer bar at the bottom.

#### Scenario: Route renders detail page
- **WHEN** the user navigates to `/pipelines/some-id`
- **THEN** `PipelineDetailPage` is rendered

### Requirement: Back navigation to pipeline list
The pipeline detail page SHALL provide a back navigation affordance that links to `/pipelines`.

#### Scenario: Back link is present and correct
- **WHEN** `PipelineDetailPage` is rendered
- **THEN** a link element pointing to `/pipelines` is visible on the page

### Requirement: Source selector bar loads from API
The bound-source bar SHALL display the pipeline's single bound data source, read-only: the source name (`currentPipeline.sourceDataSourceName`) and, when a matching `DataSource` is resolvable by id (`currentPipeline.sourceDataSourceId`) from the already-fetched `state.sources.items` (loaded via the `fetchSources` thunk), its kind (CSV / REST API / SQL / Static). The bar SHALL NOT offer per-source toggling, a preview affordance, or a "Connect source" action — a pipeline has exactly one input source, so there is nothing to select or connect. When the matching `DataSource` is resolvable (i.e. the current user owns it), the bar SHALL show an "Edit Source" button that, when clicked, sets `sources.selectedSourceId` to that source's id and navigates to `/sources`. When no matching `DataSource` is resolvable, the "Edit Source" button SHALL NOT be rendered.

#### Scenario: Bound source name and kind are rendered
- **WHEN** `state.sources.items` contains a DataSource whose id matches `currentPipeline.sourceDataSourceId`
- **THEN** the bound-source bar shows that source's name and its kind label

#### Scenario: Bound source name renders without a kind badge when unresolved
- **WHEN** no DataSource in `state.sources.items` matches `currentPipeline.sourceDataSourceId`
- **THEN** the bound-source bar shows the source name with no kind badge

#### Scenario: Edit Source button shown when the current user owns the source
- **WHEN** `state.sources.items` contains a DataSource whose id matches `currentPipeline.sourceDataSourceId`
- **THEN** an "Edit Source" button is visible in the bound-source bar

#### Scenario: Edit Source button hidden when the current user does not own the source
- **WHEN** no DataSource in `state.sources.items` matches `currentPipeline.sourceDataSourceId` (e.g. the pipeline was shared with the current user by a pipeline-sharing grant, but the underlying source belongs to someone else)
- **THEN** no "Edit Source" button is rendered in the bound-source bar

#### Scenario: Clicking Edit Source navigates to the source detail page
- **WHEN** the user clicks the "Edit Source" button
- **THEN** `sources.selectedSourceId` is set to the bound source's id and the app navigates to `/sources`

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

### Requirement: Bound-type bar displays the pipeline's output DataType
`PipelineDetailPage` SHALL render a read-only bound-type bar showing the pipeline's output DataType name (`currentPipeline.outputDataTypeName`). The page SHALL fetch `state.dataTypes.items` (via the `fetchDataTypes` thunk) on mount if not already loaded, so ownership of the output DataType can be determined the same way source ownership is: by presence in the already-fetched, owner-scoped list.

#### Scenario: Bound-type bar shows the output type name
- **WHEN** `PipelineDetailPage` is rendered with a loaded `currentPipeline`
- **THEN** the bound-type bar shows `currentPipeline.outputDataTypeName`

### Requirement: Edit Type button is ownership-gated
When `state.dataTypes.items` contains a DataType whose id matches `currentPipeline.outputDataTypeId` (i.e. the current user owns it), the bound-type bar SHALL show an "Edit Type" button that, when clicked, sets `dataTypes.selectedTypeId` to that DataType's id and navigates to `/registry`. When no matching DataType is found in `state.dataTypes.items`, the "Edit Type" button SHALL NOT be rendered.

#### Scenario: Edit Type button shown when the current user owns the output type
- **WHEN** `state.dataTypes.items` contains a DataType whose id matches `currentPipeline.outputDataTypeId`
- **THEN** an "Edit Type" button is visible in the bound-type bar

#### Scenario: Edit Type button hidden when the current user does not own the output type
- **WHEN** no DataType in `state.dataTypes.items` matches `currentPipeline.outputDataTypeId`
- **THEN** no "Edit Type" button is rendered in the bound-type bar

#### Scenario: Clicking Edit Type navigates to the type registry
- **WHEN** the user clicks the "Edit Type" button
- **THEN** `dataTypes.selectedTypeId` is set to the output DataType's id and the app navigates to `/registry`

### Requirement: Pipeline-sharing role does not grant source/type edit access
A pipeline-sharing `editor` or `viewer` grant (see `pipeline-sharing`) confers no ownership of the pipeline's bound DataSource or output DataType. The "Edit Source" / "Edit Type" buttons SHALL be gated solely on DataSource/DataType ownership (presence in the current user's owner-scoped `sources.items` / `dataTypes.items`), never on pipeline ownership or pipeline-sharing role alone.

#### Scenario: Shared pipeline editor without source ownership sees no Edit Source button
- **WHEN** the current user has an `editor` grant on the pipeline but does not own its bound
  DataSource (it is absent from `state.sources.items`)
- **THEN** no "Edit Source" button is rendered, even though the user can edit pipeline steps


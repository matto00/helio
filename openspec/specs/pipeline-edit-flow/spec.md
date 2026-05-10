# pipeline-edit-flow Specification

## Purpose
TBD - created by archiving change pipeline-create-edit-flow. Update Purpose after archive.
## Requirements
### Requirement: GET /api/pipelines/:id returns a single pipeline
The backend SHALL expose `GET /api/pipelines/:id` that returns the pipeline summary for the given id.
The response shape SHALL match the list items: `id`, `name`, `sourceDataSourceName`,
`outputDataTypeName`, `lastRunStatus`, `lastRunAt`.

#### Scenario: Existing pipeline returned
- **WHEN** `GET /api/pipelines/:id` is called with a valid pipeline id
- **THEN** the response is `200 OK` with the pipeline summary JSON

#### Scenario: Unknown pipeline returns 404
- **WHEN** `GET /api/pipelines/:id` is called with an id that does not exist
- **THEN** the response is `404 Not Found`

### Requirement: PATCH /api/pipelines/:id updates pipeline name
The backend SHALL expose `PATCH /api/pipelines/:id` accepting `{ name }` (non-empty string).
It SHALL update the pipeline name, set `updated_at` to the current time, and return the updated
pipeline summary with `200 OK`.

#### Scenario: Successful name update returns 200
- **WHEN** `PATCH /api/pipelines/:id` is called with `{ name: "New Name" }`
- **THEN** the response is `200 OK` with the updated pipeline summary including the new name

#### Scenario: Empty name returns 400
- **WHEN** `PATCH /api/pipelines/:id` is called with `{ name: "" }`
- **THEN** the response is `400 Bad Request`

#### Scenario: Unknown pipeline returns 404
- **WHEN** `PATCH /api/pipelines/:id` is called with an id that does not exist
- **THEN** the response is `404 Not Found`

### Requirement: fetchPipelineById thunk loads a single pipeline into Redux
The frontend SHALL provide a `fetchPipelineById` async thunk in `pipelinesSlice` that calls
`GET /api/pipelines/:id` and stores the result in a `currentPipeline` field in Redux state.
State SHALL track `currentPipelineStatus` (`idle` | `loading` | `succeeded` | `failed`) and
`currentPipelineError`.

#### Scenario: Thunk updates currentPipeline on success
- **WHEN** `fetchPipelineById` is dispatched with a valid pipeline id
- **THEN** `currentPipeline` in Redux state is set to the returned pipeline summary

#### Scenario: Thunk sets error on failure
- **WHEN** `fetchPipelineById` is dispatched and the API returns an error
- **THEN** `currentPipelineStatus` is `"failed"` and `currentPipelineError` is set

### Requirement: fetchPipelineSteps thunk loads steps into Redux
The frontend SHALL provide a `fetchPipelineSteps` async thunk in `pipelinesSlice` that calls
`GET /api/pipelines/:id/steps` and stores the result in a `steps` map keyed by pipeline id.
State SHALL track `stepsStatus` (per-pipeline) and `stepsError`.

#### Scenario: Thunk stores steps for pipeline
- **WHEN** `fetchPipelineSteps` is dispatched with a valid pipeline id
- **THEN** `steps[pipelineId]` in Redux state is set to the returned step array

#### Scenario: Empty steps array is handled
- **WHEN** `fetchPipelineSteps` returns an empty array
- **THEN** `steps[pipelineId]` is set to `[]` and no error is set

### Requirement: updatePipeline thunk persists name changes
The frontend SHALL provide an `updatePipeline` async thunk in `pipelinesSlice` that calls
`PATCH /api/pipelines/:id` with `{ name }` and updates `currentPipeline` in Redux state on success.

#### Scenario: Successful update refreshes currentPipeline
- **WHEN** `updatePipeline` is dispatched with a valid id and name
- **THEN** `currentPipeline.name` in Redux state reflects the new name

#### Scenario: Failed update sets error state
- **WHEN** `updatePipeline` is dispatched and the API returns an error
- **THEN** `updateStatus` is `"failed"` and `updateError` is set

### Requirement: PipelineDetailPage loads pipeline and steps on mount
`PipelineDetailPage` SHALL dispatch `fetchPipelineById` and `fetchPipelineSteps` on mount
(when the pipeline id changes). It SHALL show a loading spinner while either request is pending,
and an error message if either request fails.

#### Scenario: Loading spinner shown while fetching
- **WHEN** `PipelineDetailPage` is mounted and the pipeline has not been loaded yet
- **THEN** a loading indicator is visible

#### Scenario: Pipeline name shown after load
- **WHEN** `fetchPipelineById` succeeds
- **THEN** the pipeline name from the API response is displayed in the page

#### Scenario: Error message shown on fetch failure
- **WHEN** `fetchPipelineById` fails
- **THEN** an error message is visible on the page

### Requirement: Save action persists the pipeline name
`PipelineDetailPage` SHALL render a Save button that dispatches `updatePipeline` with the current
(possibly edited) name. On success it SHALL navigate to `/pipelines`.

#### Scenario: Save navigates to pipeline list on success
- **WHEN** the user clicks Save and `PATCH /api/pipelines/:id` succeeds
- **THEN** the user is navigated to `/pipelines`

#### Scenario: Save shows error on failure
- **WHEN** the user clicks Save and `PATCH /api/pipelines/:id` fails
- **THEN** an error message is displayed and navigation does not occur

### Requirement: Dirty-state detection tracks unsaved changes
The page SHALL track whether the current form state (pipeline name) differs from the originally
loaded state. The Save and Cancel buttons SHALL only show when `isDirty` is `true`.

#### Scenario: Save and Cancel appear when name is changed
- **WHEN** the user edits the pipeline output name to differ from the loaded name
- **THEN** Save and Cancel buttons are visible

#### Scenario: Save and Cancel hidden when name matches original
- **WHEN** the edited name matches the originally loaded pipeline name
- **THEN** Save and Cancel buttons are not visible

### Requirement: Cancel action with confirmation on dirty state
When the form is dirty, clicking Cancel SHALL show a confirmation prompt. If the user confirms,
all local changes SHALL be discarded and the user SHALL be navigated to `/pipelines`.
If the user cancels the prompt, the form SHALL remain open with its current state.

#### Scenario: Dirty cancel navigates away after confirmation
- **WHEN** the user has unsaved changes and clicks Cancel, then confirms the prompt
- **THEN** the user is navigated to `/pipelines`

#### Scenario: Dirty cancel stays on page when prompt is dismissed
- **WHEN** the user has unsaved changes and clicks Cancel, then dismisses the prompt
- **THEN** the user remains on the pipeline detail page with changes intact

### Requirement: beforeunload guard warns on dirty state
When the form is dirty, the browser's `beforeunload` event SHALL fire a warning if the user
attempts to close the tab or navigate away via the browser chrome. When the form is clean,
no `beforeunload` handler SHALL be registered.

#### Scenario: beforeunload fires when dirty
- **WHEN** the form is dirty and a `beforeunload` event is triggered
- **THEN** the event's `returnValue` is set (browser will show a leave confirmation)

#### Scenario: beforeunload not registered when clean
- **WHEN** the form is clean
- **THEN** no `beforeunload` handler prevents navigation

### Requirement: Pipeline editor registers the cast op type with correct seed config
The pipeline editor's `OP_TYPES` registry SHALL include an entry for `"cast"` with a seed config of
`'{"casts":{}}'`. When a new cast step is created, the step config SHALL be initialized to
`'{"casts":{}}'`. When a cast step card is expanded, the editor SHALL render the `CastFieldsConfig`
component.

#### Scenario: New cast step is seeded with casts map config
- **WHEN** the user adds a new step with `op: "cast"`
- **THEN** the initial persisted config is `{"casts":{}}`

#### Scenario: Cast step card renders CastFieldsConfig component
- **WHEN** a pipeline step with `op: "cast"` has its card expanded
- **THEN** the `CastFieldsConfig` component is rendered in the step-card body


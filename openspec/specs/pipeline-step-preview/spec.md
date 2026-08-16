# pipeline-step-preview Specification

## Purpose
TBD - created by archiving change step-preview-ui. Update Purpose after archive.
## Requirements
### Requirement: GET /api/pipelines/:id/steps/:stepId/preview returns sample rows up to a step
The backend SHALL expose `GET /api/pipelines/:id/steps/:stepId/preview`. The endpoint SHALL:
- Fetch all steps for the pipeline ordered by `position`
- Find the step with `id == stepId` and determine its position K
- Execute steps 0 through K (inclusive) against the source DataSource using the in-process engine
- Return the first 10 rows of the result as `{ rows: [...], rowCount: N }` where `rowCount` is
  the total number of rows produced (not capped at 10)
- Return `200 OK` on success
- Return `404 Not Found` if the pipeline or step is not found
- Return `422 Unprocessable Entity` if the source type is unsupported (RestApi, Sql)

#### Scenario: Returns first 10 rows for a valid step
- **WHEN** `GET /api/pipelines/:id/steps/:stepId/preview` is called for a pipeline with a static
  data source and a select step at position 0
- **THEN** the response is `200 OK` with a `rows` array containing at most 10 rows and a
  `rowCount` field equal to the total number of rows produced after applying steps 0..0

#### Scenario: Steps after the target step are not applied
- **WHEN** a pipeline has a select step at position 0 followed by a limit step at position 1,
  and preview is requested for the select step (position 0)
- **THEN** the response rows reflect only the select step applied; the limit step is not applied

#### Scenario: Returns 404 for unknown pipeline
- **WHEN** `GET /api/pipelines/nonexistent/steps/any-step-id/preview` is called
- **THEN** the response is `404 Not Found`

#### Scenario: Returns 404 for unknown step
- **WHEN** `GET /api/pipelines/:id/steps/nonexistent-step-id/preview` is called with a valid pipeline
- **THEN** the response is `404 Not Found`

#### Scenario: Returns 422 for unsupported source type
- **WHEN** the pipeline's source DataSource has type `rest_api` or `sql`
- **THEN** the response is `422 Unprocessable Entity` with a descriptive error message

### Requirement: StepCard Preview button fetches and renders sample rows
The frontend StepCard component SHALL:
- When the preview is active (expanded card with the preview open), call
  `GET /api/pipelines/:id/steps/:stepId/preview` and render the sample rows (up to 10) in the
  shared `DataGrid` preview variant below the config editor, inside the expanded step card body
- Render the step's output schema (column name + type) alongside the sample rows, sourced
  client-side from the analyze endpoint's per-step `outputSchema` (no new backend call)
- Omit the schema display (rows still render) when analyze data for the step is unavailable
- Show a loading indicator while the preview request is in flight
- On error, show an inline error message
- Toggling the preview control SHALL hide the preview (toggle behavior)
- Persist the open/closed preview preference per user (localStorage), so a user who left the
  preview open gets an auto-opened preview on subsequently expanded step cards
- Re-fetch the preview rows automatically, debounced, after the step's persisted config changes
  **or the step's position in the editor's step list changes (reorder)** while the preview is
  active — without requiring a manual close/reopen or a full pipeline run

#### Scenario: Preview shows sample rows and output schema together
- **WHEN** the user activates the preview on an expanded StepCard for a pipeline with static data
  and analyze data is available for that step
- **THEN** a table of up to 10 rows appears below the config editor together with the step's
  output schema listing each column name and type

#### Scenario: Schema display is omitted when analyze data is unavailable
- **WHEN** the preview is active but the analyze result has no entry for the step (pending,
  failed, or unknown step id)
- **THEN** the sample rows render without a schema display and no error is shown for the
  missing schema

#### Scenario: Preview refreshes after a config edit settles
- **WHEN** the preview is active and the user edits the step's config such that a PATCH persists
  a new config
- **THEN** the preview rows re-fetch automatically after a debounce interval, without the user
  toggling the preview or running the pipeline

#### Scenario: Preview refreshes after a reorder
- **WHEN** the preview is active on a step and the step's position in the step list changes via
  a reorder
- **THEN** the preview rows re-fetch automatically after a debounce interval, reflecting the
  step's new upstream prefix

#### Scenario: Closed preview does not refresh on config edits
- **WHEN** the preview is closed and the user edits the step's config
- **THEN** no preview request is issued

#### Scenario: Preview open state persists as a user preference
- **WHEN** the user opens the preview on one step card and later expands another step card (or
  reloads the editor)
- **THEN** the preview auto-opens on the newly expanded card, and after the user hides the
  preview, subsequently expanded cards default to closed

#### Scenario: Preview loading state is shown
- **WHEN** the preview request is in flight
- **THEN** a "Loading preview..." text is shown in place of the table

#### Scenario: Preview error state is shown
- **WHEN** the preview request fails (e.g. network error or 422)
- **THEN** an inline error message is shown instead of the table

#### Scenario: Second toggle hides the preview
- **WHEN** the preview is visible and the user toggles the preview control again
- **THEN** the preview is hidden and the control reflects the collapsed state


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
- On click of "Preview data", call `GET /api/pipelines/:id/steps/:stepId/preview`
- Show a loading indicator while the request is in flight
- On success, render the sample rows in a table with headers derived from the first row's keys
- On error, show an inline error message
- Toggling "Preview data" again SHALL hide the table (toggle behavior)
- The preview table SHALL be rendered below the config editor, inside the expanded step card body

#### Scenario: Preview button shows sample rows
- **WHEN** the user clicks "Preview data" on an expanded StepCard for a pipeline with static data
- **THEN** a table of up to 10 rows appears below the config editor

#### Scenario: Preview loading state is shown
- **WHEN** the preview request is in flight
- **THEN** a "Loading preview..." text is shown in place of the table

#### Scenario: Preview error state is shown
- **WHEN** the preview request fails (e.g. network error or 422)
- **THEN** an inline error message is shown instead of the table

#### Scenario: Second click on Preview button hides the table
- **WHEN** the preview table is visible and the user clicks "Preview data" again
- **THEN** the table is hidden and the button label reflects the collapsed state


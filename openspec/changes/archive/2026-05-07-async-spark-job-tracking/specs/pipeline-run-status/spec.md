## ADDED Requirements

### Requirement: POST /api/pipelines/:id/run submits a Spark job
The backend SHALL expose `POST /api/pipelines/:id/run`. When called for a valid pipeline whose
data source type is `static` or `csv`, it SHALL submit an async Spark job, register the run in the
in-memory cache with status `queued`, and return `201 Created` with `{ runId: string }`.

#### Scenario: Successful submission returns 201 with runId
- **WHEN** `POST /api/pipelines/:id/run` is called with a valid pipeline id
- **THEN** the response is `201 Created` with a JSON body containing a non-empty `runId` string

#### Scenario: Unknown pipeline returns 404
- **WHEN** `POST /api/pipelines/:id/run` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

### Requirement: GET /api/pipelines/:id/runs/:runId returns current status
The backend SHALL expose `GET /api/pipelines/:id/runs/:runId`. It SHALL return `200 OK` with
`{ runId, status, rows?, error? }`. `status` SHALL be one of `queued`, `running`, `succeeded`,
`failed`. `rows` SHALL be present when `status` is `succeeded`. `error` SHALL be present when
`status` is `failed`.

#### Scenario: Queued run returns status queued
- **WHEN** `GET /api/pipelines/:id/runs/:runId` is called immediately after submission
- **THEN** the response is `200 OK` with `status: "queued"`

#### Scenario: Completed run returns status succeeded with rows
- **WHEN** the Spark job finishes successfully and the status endpoint is polled
- **THEN** the response is `200 OK` with `status: "succeeded"` and a `rows` array present

#### Scenario: Failed run returns status failed with error
- **WHEN** the Spark job throws an exception and the status endpoint is polled
- **THEN** the response is `200 OK` with `status: "failed"` and an `error` string present

#### Scenario: Unknown runId returns 404
- **WHEN** `GET /api/pipelines/:id/runs/:runId` is called with an unknown runId
- **THEN** the response is `404 Not Found`

### Requirement: Frontend polls run status and surfaces it in the pipeline detail page
The `PipelineDetailPage` footer SHALL include a run-status indicator. When the user clicks
"Run pipeline", the frontend SHALL call `POST /api/pipelines/:id/run`, receive a `runId`, and
begin polling `GET /api/pipelines/:id/runs/:runId` every 2 seconds. The status indicator SHALL
update to reflect `queued`, `running`, `succeeded`, or `failed`. Polling SHALL stop when the
status reaches a terminal state (`succeeded` or `failed`) or when the component unmounts.

#### Scenario: Clicking Run pipeline triggers job submission
- **WHEN** the user clicks "Run pipeline" on the pipeline detail page
- **THEN** `POST /api/pipelines/:id/run` is called and the status indicator changes from idle to "queued"

#### Scenario: Status indicator shows running while job executes
- **WHEN** the polled status is "running"
- **THEN** the status indicator displays a "running" state

#### Scenario: Status indicator shows succeeded on completion
- **WHEN** the polled status is "succeeded"
- **THEN** the status indicator displays a "succeeded" state and polling stops

#### Scenario: Status indicator shows failed on error
- **WHEN** the polled status is "failed"
- **THEN** the status indicator displays a "failed" state and polling stops

#### Scenario: Polling stops on component unmount
- **WHEN** the user navigates away from the pipeline detail page while a run is in progress
- **THEN** no further polling requests are made after the component unmounts

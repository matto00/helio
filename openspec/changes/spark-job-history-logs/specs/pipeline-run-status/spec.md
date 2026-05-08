## MODIFIED Requirements

### Requirement: GET /api/pipelines/:id/runs/:runId returns current status
The backend SHALL expose `GET /api/pipelines/:id/runs/:runId`. It SHALL return `200 OK` with
`{ runId, status, rowCount?, rows?, error? }`. `status` SHALL be one of `queued`, `running`,
`succeeded`, `failed`. `rowCount` SHALL be a non-negative integer present when `status` is
`succeeded`. `rows` SHALL be present when `status` is `succeeded`. `error` SHALL be present when
`status` is `failed`.

#### Scenario: Queued run returns status queued
- **WHEN** `GET /api/pipelines/:id/runs/:runId` is called immediately after submission
- **THEN** the response is `200 OK` with `status: "queued"`

#### Scenario: Completed run returns status succeeded with rows and rowCount
- **WHEN** the Spark job finishes successfully and the status endpoint is polled
- **THEN** the response is `200 OK` with `status: "succeeded"`, a `rows` array present, and `rowCount` equal to the number of result rows

#### Scenario: Failed run returns status failed with error
- **WHEN** the Spark job throws an exception and the status endpoint is polled
- **THEN** the response is `200 OK` with `status: "failed"` and an `error` string present

#### Scenario: Unknown runId returns 404
- **WHEN** `GET /api/pipelines/:id/runs/:runId` is called with an unknown runId
- **THEN** the response is `404 Not Found`

## ADDED Requirements

### Requirement: POST /api/pipelines/:id/run triggers a Spark job
The backend SHALL expose `POST /api/pipelines/:id/run` (authenticated) that:
1. Validates the pipeline exists (404 if not).
2. Validates the pipeline's source data source type is supported (`static` or `csv`); returns
   `422 Unprocessable Entity` with an error message for unsupported types (`rest_api`, `sql`).
3. Fetches the pipeline's ordered steps from `PipelineStepRepository`.
4. Calls `SparkJobSubmitter.submit(pipeline, steps)` asynchronously.
5. Stores an entry in `PipelineRunCache` with `status: queued` immediately.
6. Returns `201 Created` with body `{ "runId": "<uuid>" }`.

#### Scenario: Successful job submission returns 201 with runId
- **WHEN** `POST /api/pipelines/:id/run` is called for an existing pipeline with a supported source type
- **THEN** the response is `201 Created` with a JSON body containing a non-empty string `runId`

#### Scenario: Unknown pipeline returns 404
- **WHEN** `POST /api/pipelines/:id/run` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: Unsupported source type returns 422
- **WHEN** `POST /api/pipelines/:id/run` is called for a pipeline whose source data source type is `rest_api` or `sql`
- **THEN** the response is `422 Unprocessable Entity` with an error message indicating the source type is not yet supported

#### Scenario: Run appears in cache with queued status immediately
- **WHEN** `POST /api/pipelines/:id/run` returns a runId
- **THEN** an immediate `GET /api/pipelines/:id/runs/:runId` returns `status: "queued"` or `status: "running"` (the job may have advanced)

### Requirement: GET /api/pipelines/:id/runs/:runId returns run status and results
The backend SHALL expose `GET /api/pipelines/:id/runs/:runId` (authenticated) that looks up the
runId in `PipelineRunCache` and returns:
- `200 OK` with body:
  ```json
  {
    "runId": "<uuid>",
    "status": "queued|running|succeeded|failed",
    "rows": [...],    // present and non-null only when status is "succeeded"
    "error": "..."    // present and non-null only when status is "failed"
  }
  ```
- `404 Not Found` if the runId is not in the cache.
The `rows` field is an array of objects, each representing one result row as a map of column name
to value. The `error` field is a plain string describing the failure cause.

#### Scenario: Returns queued status while job is pending
- **WHEN** `GET /api/pipelines/:id/runs/:runId` is called immediately after job submission and before the job finishes
- **THEN** the response is `200 OK` with `status: "queued"` or `status: "running"` and `rows` is absent or null

#### Scenario: Returns succeeded status with rows on completion
- **WHEN** the Spark job completes successfully and `GET /api/pipelines/:id/runs/:runId` is called
- **THEN** the response is `200 OK` with `status: "succeeded"` and `rows` is a non-null array of row objects

#### Scenario: Returns failed status with error on job failure
- **WHEN** the Spark job throws an exception and `GET /api/pipelines/:id/runs/:runId` is called
- **THEN** the response is `200 OK` with `status: "failed"` and `error` contains a non-empty string

#### Scenario: Unknown runId returns 404
- **WHEN** `GET /api/pipelines/:id/runs/:runId` is called with a runId that was never submitted
- **THEN** the response is `404 Not Found`

## MODIFIED Requirements

### Requirement: GET /api/pipelines returns pipeline summaries
The backend SHALL expose `GET /api/pipelines` that returns a JSON array of pipeline summary
objects. Each object SHALL include: `id`, `name`, `sourceDataSourceName`. `lastRunStatus`,
`lastRunAt`, and `lastRunRowCount` SHALL be present with their real values once a pipeline has run,
and SHALL be ABSENT from the response entirely (not present as `null`) for a pipeline that has
never run — `PipelineSummaryResponse`'s fields are `Option[...]` serialized via `jsonFormat9` with
no `NullOptions` mixed in, so spray-json omits a `None` field rather than writing `null`.
the retired `outputDataTypeName`/`output_data_type_id` fields are no longer included — a pipeline's Outputs are fetched
via `GET /api/pipelines/:id/outputs`.

#### Scenario: Returns empty array when no pipelines exist
- **WHEN** `GET /api/pipelines` is called and no pipelines exist
- **THEN** the response is `200 OK` with body `[]`

#### Scenario: Returns pipeline summaries with joined names
- **WHEN** one or more pipelines exist and `GET /api/pipelines` is called
- **THEN** the response is `200 OK` with an array where each item includes `sourceDataSourceName`
  from the joined data source and none of the retired `outputDataTypeName`/`output_data_type_id` fields

#### Scenario: Absent last-run fields for pipelines that have never run
- **WHEN** a pipeline has never been run
- **THEN** `lastRunStatus`, `lastRunAt`, and `lastRunRowCount` are all ABSENT from the response
  (not present as `null`)

#### Scenario: Non-null last-run fields for pipelines that have run
- **WHEN** a pipeline has a recorded last run
- **THEN** `lastRunStatus` is either `"succeeded"` or `"failed"`, `lastRunAt` is an ISO-8601
  timestamp, and `lastRunRowCount` is a non-negative integer

## MODIFIED Requirements

### Requirement: GET /api/pipelines returns pipeline summaries
The backend SHALL expose `GET /api/pipelines` that returns a JSON array of pipeline summary objects.
Each object SHALL include: `id`, `name`, `sourceDataSourceName`, `outputDataTypeName`,
`outputDataTypeId`, `lastRunStatus` (string or null), `lastRunAt` (ISO-8601 string or null),
and `lastRunRowCount` (number or null).

#### Scenario: Returns empty array when no pipelines exist
- **WHEN** `GET /api/pipelines` is called and no pipelines exist
- **THEN** the response is `200 OK` with body `[]`

#### Scenario: Returns pipeline summaries with joined names
- **WHEN** one or more pipelines exist and `GET /api/pipelines` is called
- **THEN** the response is `200 OK` with an array where each item includes `sourceDataSourceName`
  from the joined data source and `outputDataTypeName` from the joined data type

#### Scenario: Null last-run fields for pipelines that have never run
- **WHEN** a pipeline has never been run
- **THEN** `lastRunStatus`, `lastRunAt`, and `lastRunRowCount` are all `null` in the response

#### Scenario: Non-null last-run fields for pipelines that have run
- **WHEN** a pipeline has a recorded last run
- **THEN** `lastRunStatus` is either `"succeeded"` or `"failed"`, `lastRunAt` is an ISO-8601
  timestamp, and `lastRunRowCount` is a non-negative integer

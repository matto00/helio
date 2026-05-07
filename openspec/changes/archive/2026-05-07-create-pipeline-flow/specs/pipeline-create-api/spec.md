## ADDED Requirements

### Requirement: POST /api/pipelines creates a new pipeline
The backend SHALL expose `POST /api/pipelines` accepting a JSON body with fields:
`name` (string, required, non-empty), `sourceDataSourceId` (string, required),
`outputDataTypeName` (string, required, non-empty). The endpoint SHALL create a new DataType row
with the given `outputDataTypeName`, create a new pipeline row referencing that DataType and the
given `sourceDataSourceId`, and return a `201 Created` response with the created pipeline summary
(same fields as the GET /api/pipelines list items: `id`, `name`, `sourceDataSourceName`,
`outputDataTypeName`, `lastRunStatus`, `lastRunAt`).

#### Scenario: Successful pipeline creation returns 201 with summary
- **WHEN** `POST /api/pipelines` is called with valid `{ name, sourceDataSourceId, outputDataTypeName }`
- **THEN** the response is `201 Created` with a JSON body containing the new pipeline's `id`, `name`,
  `sourceDataSourceName` (from the referenced data source), `outputDataTypeName` (as supplied),
  `lastRunStatus: null`, and `lastRunAt: null`

#### Scenario: Missing required field returns 400
- **WHEN** `POST /api/pipelines` is called with a missing or empty required field
- **THEN** the response is `400 Bad Request` with an error message

#### Scenario: Non-existent sourceDataSourceId returns 404
- **WHEN** `POST /api/pipelines` is called with a `sourceDataSourceId` that does not exist
- **THEN** the response is `404 Not Found` with an error message

#### Scenario: Created pipeline appears in GET /api/pipelines list
- **WHEN** a pipeline is created via `POST /api/pipelines`
- **THEN** a subsequent `GET /api/pipelines` includes the new pipeline in the response array

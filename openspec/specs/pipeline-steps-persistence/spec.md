# pipeline-steps-persistence Specification

## Purpose
TBD - created by archiving change pipeline-steps-db-api. Update Purpose after archive.
## Requirements
### Requirement: Pipeline steps table exists in the database
The backend SHALL maintain a `pipeline_steps` table with columns: `id` (TEXT PK),
`pipeline_id` (TEXT FK → pipelines ON DELETE CASCADE), `position` (INT NOT NULL),
`op` (TEXT with CHECK constraint: one of 'rename', 'filter', 'join', 'compute', 'groupby', 'cast'),
`config` (TEXT NOT NULL — JSON blob), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
An index SHALL exist on `pipeline_id`. This table SHALL be created via Flyway migration V23.

#### Scenario: Pipeline steps table is created on migration
- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipeline_steps` table exists with the specified columns, FK, CHECK constraint, and index

#### Scenario: Deleting a pipeline cascades to its steps
- **WHEN** a pipeline is deleted from the `pipelines` table
- **THEN** all associated rows in `pipeline_steps` are automatically deleted via ON DELETE CASCADE

### Requirement: GET /api/pipelines/:id/steps returns ordered steps
The backend SHALL expose `GET /api/pipelines/:id/steps` that returns a JSON array of step objects
for the given pipeline, ordered ascending by `position`. Each object SHALL include: `id`, `pipelineId`,
`position`, `op`, `config` (raw JSON string), `createdAt` (ISO-8601), `updatedAt` (ISO-8601).

#### Scenario: Returns empty array when pipeline has no steps
- **WHEN** `GET /api/pipelines/:id/steps` is called for a pipeline with no steps
- **THEN** the response is `200 OK` with body `[]`

#### Scenario: Returns steps in position order
- **WHEN** a pipeline has multiple steps and `GET /api/pipelines/:id/steps` is called
- **THEN** the response is `200 OK` with steps sorted ascending by `position`

#### Scenario: Returns 404 for unknown pipeline
- **WHEN** `GET /api/pipelines/:id/steps` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

### Requirement: POST /api/pipelines/:id/steps appends a new step
The backend SHALL expose `POST /api/pipelines/:id/steps` that accepts `{ op, config }` in the
request body, assigns the next available position (MAX(position)+1 or 0 if no steps exist), persists
the step, and returns the created step object with `201 Created`.

#### Scenario: First step gets position 0
- **WHEN** `POST /api/pipelines/:id/steps` is called and the pipeline has no existing steps
- **THEN** the created step has `position: 0` and the response is `201 Created`

#### Scenario: Subsequent steps get incrementing positions
- **WHEN** `POST /api/pipelines/:id/steps` is called and the pipeline already has steps
- **THEN** the created step has `position` equal to the current maximum position plus one

#### Scenario: Returns 404 for unknown pipeline
- **WHEN** `POST /api/pipelines/:id/steps` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: Returns 400 for invalid op
- **WHEN** `POST /api/pipelines/:id/steps` is called with an `op` value not in the allowed set
- **THEN** the response is `400 Bad Request`

### Requirement: PATCH /api/pipeline-steps/:id updates a step
The backend SHALL expose `PATCH /api/pipeline-steps/:id` that accepts an optional `config` and/or
optional `position` field, applies the update, sets `updated_at` to the current time, and returns
the updated step object with `200 OK`.

#### Scenario: Config update succeeds
- **WHEN** `PATCH /api/pipeline-steps/:id` is called with a new `config` value
- **THEN** the step's `config` is updated, `updated_at` is refreshed, and `200 OK` is returned

#### Scenario: Position update succeeds
- **WHEN** `PATCH /api/pipeline-steps/:id` is called with a new `position` value
- **THEN** the step's `position` is updated and `200 OK` is returned

#### Scenario: Returns 404 for unknown step
- **WHEN** `PATCH /api/pipeline-steps/:id` is called with a step id that does not exist
- **THEN** the response is `404 Not Found`

### Requirement: DELETE /api/pipeline-steps/:id removes a step
The backend SHALL expose `DELETE /api/pipeline-steps/:id` that removes the step and returns
`204 No Content` on success.

#### Scenario: Existing step is deleted
- **WHEN** `DELETE /api/pipeline-steps/:id` is called for an existing step
- **THEN** the step is removed from the database and the response is `204 No Content`

#### Scenario: Returns 404 for unknown step
- **WHEN** `DELETE /api/pipeline-steps/:id` is called with a step id that does not exist
- **THEN** the response is `404 Not Found`


## MODIFIED Requirements

### Requirement: Pipeline steps table exists in the database

The backend SHALL maintain a `pipeline_steps` table with columns: `id` (TEXT PK),
`pipeline_id` (TEXT FK → pipelines ON DELETE CASCADE), `position` (INT NOT NULL),
`op` (TEXT with CHECK constraint: one of 'rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount'),
`config` (TEXT NOT NULL — JSON blob), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
An index SHALL exist on `pipeline_id`. This table SHALL be created via Flyway migration V23 and the
CHECK constraint SHALL be extended to include `'select'` via Flyway migration V25, `'limit'` via V26,
`'sort'` via V27, `'aggregate'` via V31, `'splittext'` via V50, `'extractheadings'` via V51, and
`'chunkbytokencount'` via V52.

#### Scenario: Pipeline steps table is created on migration

- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipeline_steps` table exists with the specified columns, FK, CHECK constraint (including `'chunkbytokencount'`), and index

#### Scenario: Deleting a pipeline cascades to its steps

- **WHEN** a pipeline is deleted from the `pipelines` table
- **THEN** all associated rows in `pipeline_steps` are automatically deleted via ON DELETE CASCADE

#### Scenario: POST with type "sort" is accepted

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "sort"` and a valid `config` object
- **THEN** the response is `201 Created` and the step is persisted with `op = 'sort'`

#### Scenario: POST with type "aggregate" is accepted

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "aggregate"` and a valid `config` object
- **THEN** the response is `201 Created` and the step is persisted with `op = 'aggregate'`

#### Scenario: POST with type "splittext" is accepted

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "splittext"` and a valid `config` object
- **THEN** the response is `201 Created` and the step is persisted with `op = 'splittext'`

#### Scenario: POST with type "extractheadings" is accepted

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "extractheadings"` and a valid `config` object
- **THEN** the response is `201 Created` and the step is persisted with `op = 'extractheadings'`

#### Scenario: POST with type "chunkbytokencount" is accepted

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "chunkbytokencount"` and a valid `config` object
- **THEN** the response is `201 Created` and the step is persisted with `op = 'chunkbytokencount'`

### Requirement: GET /api/pipelines/:id/steps returns ordered typed steps

The backend SHALL expose `GET /api/pipelines/:id/steps` that returns a JSON array of step objects
for the given pipeline, ordered ascending by `position`. Each object SHALL include: `id`, `pipelineId`,
`position`, `type` (discriminator string: one of the 13 step kinds), `config` (typed object whose
shape is determined by `type`), `createdAt` (ISO-8601), `updatedAt` (ISO-8601).

#### Scenario: Returns empty array when pipeline has no steps

- **WHEN** `GET /api/pipelines/:id/steps` is called for a pipeline with no steps
- **THEN** the response is `200 OK` with body `[]`

#### Scenario: Returns steps in position order

- **WHEN** a pipeline has multiple steps and `GET /api/pipelines/:id/steps` is called
- **THEN** the response is `200 OK` with steps sorted ascending by `position`

#### Scenario: Each step's config is a typed object (not a stringified blob)

- **WHEN** a pipeline has a `filter` step with conditions `[{field, operator, value}]`
- **THEN** the response payload's `config` field is a JSON object (`{ combinator, conditions: [...] }`), not a string

#### Scenario: Returns 404 for unknown pipeline

- **WHEN** `GET /api/pipelines/:id/steps` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

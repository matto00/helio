## MODIFIED Requirements

### Requirement: Pipeline steps table exists in the database

The backend SHALL maintain a `pipeline_steps` table with columns: `id` (TEXT PK),
`pipeline_id` (TEXT FK → pipelines ON DELETE CASCADE), `position` (INT NOT NULL),
`op` (TEXT with CHECK constraint: one of 'rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings'),
`config` (TEXT NOT NULL — JSON blob), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
An index SHALL exist on `pipeline_id`. This table SHALL be created via Flyway migration V23 and the
CHECK constraint SHALL be extended to include `'select'` via Flyway migration V25, `'limit'` via V26,
`'sort'` via V27, `'aggregate'` via V31, `'splittext'` via V50, and `'extractheadings'` via V51.

#### Scenario: Pipeline steps table is created on migration

- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipeline_steps` table exists with the specified columns, FK, CHECK constraint (including `'extractheadings'`), and index

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

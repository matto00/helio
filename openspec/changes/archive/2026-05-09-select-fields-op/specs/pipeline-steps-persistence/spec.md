## MODIFIED Requirements

### Requirement: Pipeline steps table exists in the database
The backend SHALL maintain a `pipeline_steps` table with columns: `id` (TEXT PK),
`pipeline_id` (TEXT FK → pipelines ON DELETE CASCADE), `position` (INT NOT NULL),
`op` (TEXT with CHECK constraint: one of 'rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select'),
`config` (TEXT NOT NULL — JSON blob), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
An index SHALL exist on `pipeline_id`. This table SHALL be created via Flyway migration V23 and the
CHECK constraint SHALL be extended to include `'select'` via Flyway migration V25.

#### Scenario: Pipeline steps table is created on migration
- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipeline_steps` table exists with the specified columns, FK, CHECK constraint (including `'select'`), and index

#### Scenario: Deleting a pipeline cascades to its steps
- **WHEN** a pipeline is deleted from the `pipelines` table
- **THEN** all associated rows in `pipeline_steps` are automatically deleted via ON DELETE CASCADE

#### Scenario: POST with op "select" is accepted
- **WHEN** `POST /api/pipelines/:id/steps` is called with `op: "select"` and a valid `config`
- **THEN** the response is `201 Created` and the step is persisted with `op = 'select'`

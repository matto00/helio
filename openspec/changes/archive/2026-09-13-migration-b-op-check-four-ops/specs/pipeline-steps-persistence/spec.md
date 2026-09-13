## MODIFIED Requirements

### Requirement: Pipeline steps table exists in the database

The backend SHALL maintain a `pipeline_steps` table with columns: `id` (TEXT PK),
`pipeline_id` (TEXT FK → pipelines ON DELETE CASCADE), `position` (INT NOT NULL),
`op` (TEXT with CHECK constraint: one of 'rename', 'filter', 'join', 'compute', 'groupby',
'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings',
'chunkbytokencount', 'datebucket', 'pivot', 'window', 'unpivot', 'dedupe', 'fillnull',
'stringops', 'union', 'lookup', 'assert', 'upsertsource', 'convertformat', 'analyzewithai',
'generatetext'), `config` (TEXT NOT NULL — JSON blob), `enabled` (BOOLEAN NOT NULL DEFAULT true),
`created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
An index SHALL exist on `pipeline_id`. This table SHALL be created via Flyway migration V23 and the
CHECK constraint SHALL be extended to include `'select'` via Flyway migration V25, `'limit'` via V26,
`'sort'` via V27, `'aggregate'` via V31, `'splittext'` via V50, `'extractheadings'` via V51,
`'chunkbytokencount'` via V52, `'datebucket'` via V64, `'pivot'` via V65, `'window'` via V66,
`'unpivot'` via V67, `'dedupe'` via V68, `'fillnull'` via V69, `'stringops'` via V70, `'union'` via
V71, `'lookup'` via V72, `'assert'` via V83, and `'upsertsource'`, `'convertformat'`,
`'analyzewithai'`, `'generatetext'` together via V107. The `enabled` column SHALL be added via
Flyway migration V86 with `NOT NULL DEFAULT true`, so existing rows remain enabled and behavior
is unchanged for existing pipelines.

The table SHALL additionally carry a `root_id` column referencing `pipeline_roots(id)` with `ON DELETE CASCADE`, added via Flyway migration V98. A step with no parent step SHALL have a non-null `root_id`; a step with a parent step SHALL derive its root from that parent and SHALL NOT rely on its own `root_id`.

#### Scenario: A root-level step records its root
- **WHEN** a step is appended with no parent step against a named root
- **THEN** the stored row carries that root's id in `root_id`

#### Scenario: Deleting a root cascades to its root-level steps
- **WHEN** a root with root-level steps is deleted
- **THEN** those steps are removed

#### Scenario: Pipeline steps table is created on migration

- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipeline_steps` table exists with the specified columns, FK, CHECK constraint (including `'assert'`, `'upsertsource'`, `'convertformat'`, `'analyzewithai'`, and `'generatetext'`), and index

#### Scenario: Enabled column defaults existing rows to true

- **WHEN** the enabled-column migration applies to a database with existing `pipeline_steps` rows
- **THEN** every existing row has `enabled = true` and the column is NOT NULL

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

#### Scenario: Migration B widens the CHECK constraint without registering the new ops at the API

- **WHEN** Flyway migration V107 has applied, adding `'upsertsource'`, `'convertformat'`,
  `'analyzewithai'`, `'generatetext'` to `pipeline_steps_op_check`
- **THEN** the database will accept an `INSERT` with any of those four `op` values, but
  `POST /api/pipelines/:id/steps` still rejects a request naming one of those four as `type`
  with `400 Bad Request` (per the existing "Returns 400 for invalid type discriminator"
  scenario) until each op is separately registered in `PipelineStepKind.All`

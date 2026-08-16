# pipeline-steps-persistence Specification

## Purpose

Defines the persistence model, REST contract, and wire shape for pipeline
steps. CS2c-3a (HEL-236) evolved the request/response shape from
`{ op: String, config: String }` (config as JSON-stringified blob) to a
discriminated union over `type` with a typed `config` object per subtype.
## Requirements
### Requirement: Pipeline steps table exists in the database

The backend SHALL maintain a `pipeline_steps` table with columns: `id` (TEXT PK),
`pipeline_id` (TEXT FK → pipelines ON DELETE CASCADE), `position` (INT NOT NULL),
`op` (TEXT with CHECK constraint: one of 'rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount'),
`config` (TEXT NOT NULL — JSON blob), `enabled` (BOOLEAN NOT NULL DEFAULT true),
`created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
An index SHALL exist on `pipeline_id`. This table SHALL be created via Flyway migration V23 and the
CHECK constraint SHALL be extended to include `'select'` via Flyway migration V25, `'limit'` via V26,
`'sort'` via V27, `'aggregate'` via V31, `'splittext'` via V50, `'extractheadings'` via V51, and
`'chunkbytokencount'` via V52. The `enabled` column SHALL be added via Flyway migration V86 with
`NOT NULL DEFAULT true`, so existing rows remain enabled and behavior is unchanged for existing
pipelines.

#### Scenario: Pipeline steps table is created on migration

- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipeline_steps` table exists with the specified columns, FK, CHECK constraint (including `'chunkbytokencount'`), and index

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

### Requirement: POST /api/pipelines/:id/steps appends a new step

The backend SHALL expose `POST /api/pipelines/:id/steps` that accepts
`{ type, config, position?, enabled? }` in the request body (where `config` is a typed object
whose shape is determined by `type`, `position` is an OPTIONAL integer list index into the
pipeline's current position-sorted step list, and `enabled` is an OPTIONAL boolean defaulting to
true when absent). Behavior:

- **`position` absent (default — the pre-existing contract, unchanged):** the step is appended
  with the next available position (MAX(position)+1 or 0 if no steps exist).
- **`position` present:** the value SHALL be validated as `0 ≤ position ≤ count` (where `count`
  is the pipeline's current step count; `position = count` is equivalent to append); out-of-range
  values SHALL return `422 Unprocessable Entity` with no step persisted. On success the step is
  inserted at that list index and every step position in the pipeline is renumbered contiguously
  (0..n) within a single database transaction — later steps shift down by one, and any
  pre-existing position gaps are healed as a side effect.
- **`enabled` absent:** the step is created enabled; **`enabled: false`:** the step is created
  disabled.

The endpoint SHALL persist the step and return the created step object (including its `enabled`
value) with `201 Created`. When `type` is `"join"`, the backend SHALL additionally verify that
`config.rightDataSourceId` is owned by the authenticated caller; if the source is inaccessible,
the response SHALL be `404 Not Found` and the step SHALL NOT be persisted.

#### Scenario: First step gets position 0

- **WHEN** `POST /api/pipelines/:id/steps` is called and the pipeline has no existing steps
- **THEN** the created step has `position: 0` and the response is `201 Created`

#### Scenario: Subsequent steps get incrementing positions

- **WHEN** `POST /api/pipelines/:id/steps` is called without `position` and the pipeline already
  has steps
- **THEN** the created step has `position` equal to the current maximum position plus one

#### Scenario: Created step defaults to enabled

- **WHEN** `POST /api/pipelines/:id/steps` is called without `enabled`
- **THEN** the created step has `enabled: true` in the response and in persistence

#### Scenario: Insert at the start shifts every step down

- **WHEN** a pipeline has steps A, B (positions 0, 1) and `POST` is called with `position: 0`
- **THEN** the created step has `position: 0` and A, B now have positions 1, 2, all persisted

#### Scenario: Insert in the middle shifts later steps only

- **WHEN** a pipeline has steps A, B, C (positions 0, 1, 2) and `POST` is called with `position: 1`
- **THEN** the created step has `position: 1`, A keeps position 0, and B, C now have positions
  2, 3

#### Scenario: Insert at count equals append

- **WHEN** a pipeline has 2 steps and `POST` is called with `position: 2`
- **THEN** the created step has `position: 2` and the existing steps' positions are unchanged in
  order

#### Scenario: Out-of-range position is rejected

- **WHEN** `POST` is called with `position: -1`, or with `position` greater than the pipeline's
  current step count
- **THEN** the response is `422 Unprocessable Entity` and no step is persisted

#### Scenario: Insert renumbers pre-existing gaps contiguously

- **WHEN** a pipeline's steps have non-contiguous positions (e.g. 0, 2, 5 after deletions) and
  `POST` is called with `position: 1`
- **THEN** after the insert all steps have contiguous positions 0..3 in the intended order

#### Scenario: Returns 404 for unknown pipeline

- **WHEN** `POST /api/pipelines/:id/steps` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: Returns 400 for invalid type discriminator

- **WHEN** `POST /api/pipelines/:id/steps` is called with a `type` value not in the allowed set
- **THEN** the response is `400 Bad Request`

#### Scenario: Returns 400 for malformed config payload

- **WHEN** `POST /api/pipelines/:id/steps` is called with a `type` whose `config` shape does not parse against the per-subtype schema
- **THEN** the response is `400 Bad Request` with a message identifying the offending subtype

#### Scenario: Returns 404 when join right-source is not caller-owned

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "join"` and
  `config.rightDataSourceId` referring to a data source the caller does not own
- **THEN** the response is `404 Not Found`
- **THEN** no step row is inserted

### Requirement: PATCH /api/pipeline-steps/:id updates a step

The backend SHALL expose `PATCH /api/pipeline-steps/:id` that accepts an optional `config` (typed
object matching the persisted step's `type`), an optional `position`, an optional `enabled`
boolean, and an optional `type` discriminator field. Applies the update (absent fields are
unchanged), sets `updated_at` to the current time, and returns the updated step object with
`200 OK`. Cross-type PATCH (changing `type` to a value different from the persisted row's kind)
is rejected with `400 Bad Request` — type changes require delete + create.

#### Scenario: Config update succeeds

- **WHEN** `PATCH /api/pipeline-steps/:id` is called with a new `config` object matching the step's type
- **THEN** the step's `config` is updated, `updated_at` is refreshed, and `200 OK` is returned

#### Scenario: Position update succeeds

- **WHEN** `PATCH /api/pipeline-steps/:id` is called with a new `position` value
- **THEN** the step's `position` is updated and `200 OK` is returned

#### Scenario: Enabled toggle succeeds and round-trips

- **WHEN** `PATCH /api/pipeline-steps/:id` is called with `enabled: false`, then later with
  `enabled: true`
- **THEN** each response reflects the new `enabled` value and the flag persists across a re-GET

#### Scenario: Cross-type PATCH is rejected

- **WHEN** `PATCH /api/pipeline-steps/:id` is called with a `type` field whose value differs from the persisted row's kind
- **THEN** the response is `400 Bad Request` with a message indicating type changes require delete + create

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


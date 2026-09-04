# pipeline-steps-persistence Specification

## Purpose

Defines the persistence model, REST contract, and wire shape for pipeline
steps. CS2c-3a (HEL-236) evolved the request/response shape from
`{ op: String, config: String }` (config as JSON-stringified blob) to a
discriminated union over `type` with a typed `config` object per subtype.

## Requirements

### Requirement: Pipeline steps table exists in the database
The `pipeline_steps` table SHALL carry a `root_id` column referencing `pipeline_roots(id)` with `ON DELETE CASCADE`. A step with no parent step SHALL have a non-null `root_id`; a step with a parent step SHALL derive its root from that parent and SHALL NOT rely on its own `root_id`.

#### Scenario: A root-level step records its root
- **WHEN** a step is appended with no parent step against a named root
- **THEN** the stored row carries that root's id in `root_id`

#### Scenario: Deleting a root cascades to its root-level steps
- **WHEN** a root with root-level steps is deleted
- **THEN** those steps are removed

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
The endpoint SHALL persist the step and return the created step object (including its `enabled` value) with `201 Created`. When `type` is `"join"`, `"union"` or `"lookup"`, the backend SHALL additionally verify that `config.secondaryInput` — **when and only when it is `source`-kind with a non-empty `dataSourceId`** — is owned by the authenticated caller; if the source is inaccessible, the response SHALL be `404 Not Found` and the step SHALL NOT be persisted. The legacy flat fields (`rightDataSourceId`, `otherDataSourceId`, `referenceDataSourceId`) SHALL NOT appear in this contract. A `lane`-kind `secondaryInput` SHALL NOT be routed into the ownership check; it SHALL instead be validated for same-pipeline membership and acyclicity per `pipeline-lane-rejoin-input`. A step MAY be created with a `parentStepId` naming a node that already has one or more children, at any position.

#### Scenario: First step gets position 0

- **WHEN** `POST /api/pipelines/:id/steps` is called on a pipeline with no steps
- **THEN** the created step has `position` 0

#### Scenario: Cross-user source-kind secondary input returns 404
- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "join"` and `config.secondaryInput` of `{"kind": "source", "dataSourceId": "<a source the caller does not own>"}`
- **THEN** the response is `404 Not Found`
- **THEN** no step row is inserted

#### Scenario: Lane-kind secondary input triggers no ownership check
- **WHEN** the same endpoint is called with a `lane`-kind `secondaryInput` naming a step in the same pipeline
- **THEN** the step is persisted and no data-source ownership lookup is performed

#### Scenario: A sibling may be created alongside an existing child
- **WHEN** a step is created with a `parentStepId` naming a node that already has a child
- **THEN** the step is created successfully and both children are returned as children of that node

#### Scenario: Subsequent steps get incrementing positions

- **WHEN** `POST /api/pipelines/:id/steps` is called without `position` and the pipeline already
  has steps
- **THEN** the created step extends the trunk as the current trunk-last step's sole child, with
  persisted `position: 0` (a fresh sibling group) — NOT the prior `MAX(position)+1` whole-pipeline
  value — and the new step's id is now `trunkOf(...).lastOption`

#### Scenario: Created step defaults to enabled

- **WHEN** `POST /api/pipelines/:id/steps` is called without `enabled`
- **THEN** the created step has `enabled: true` in the response and in persistence

#### Scenario: Insert at the start shifts every step down

- **WHEN** a pipeline has steps A, B (trunk order, execution-order indices 0, 1) and `POST` is
  called with `position: 0`
- **THEN** the created step is spliced in as the pipeline root's new sole child, A is re-parented
  onto it, and the resulting execution order is new-step, A, B

#### Scenario: Insert in the middle shifts later steps only

- **WHEN** a pipeline has steps A, B, C (trunk order, execution-order indices 0, 1, 2) and `POST`
  is called with `position: 1`
- **THEN** the created step is spliced onto A as A's new sole child, B is re-parented onto the new
  step, and the resulting execution order is A, new-step, B, C

#### Scenario: Insert at count equals append

- **WHEN** a pipeline has 2 steps with no tail steps (a linear trunk) and `POST` is called with
  `position: 2`
- **THEN** the created step is spliced onto the current trunk-last step (identical to the
  position-absent, trunk-continuation behavior above). This equivalence holds only in the
  tail-free case: on a pipeline whose trunk-last step already has tail steps, `position = count`
  instead anchors on that trunk-last step's last tail (per `executionOrder`'s tails-before-trunk
  emission order), not on trunk-last itself.

#### Scenario: Insert renumbers pre-existing gaps contiguously

- **WHEN** a pipeline's execution order has non-contiguous whole-pipeline indices open to the
  caller as `position` inputs (e.g. from a prior deletion) and `POST` is called with a
  mid-sequence `position`
- **THEN** the requested index is resolved against the pipeline's current execution order (which
  has no gaps — `pipeline-step-tree`'s `executionOrder` always emits every live step exactly
  once), the new step is spliced onto the resolved anchor, and the resulting execution order
  contains every step exactly once with no gaps; sibling-scoped `position` values are not a
  whole-pipeline renumbering concern under this model

#### Scenario: Out-of-range position is rejected

- **WHEN** `POST` is called with `position: -1`, or with `position` greater than the pipeline's
  current step count (counted in whole-pipeline execution order)
- **THEN** the response is `422 Unprocessable Entity` and no step is persisted

#### Scenario: Returns 404 for unknown pipeline

- **WHEN** `POST /api/pipelines/:id/steps` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: Returns 400 for invalid type discriminator

- **WHEN** `POST /api/pipelines/:id/steps` is called with a `type` value not in the allowed set
- **THEN** the response is `400 Bad Request`

#### Scenario: Returns 400 for malformed config payload

- **WHEN** `POST /api/pipelines/:id/steps` is called with a `type` whose `config` shape does not
  parse against the per-subtype schema
- **THEN** the response is `400 Bad Request` with a message identifying the offending subtype

#### Scenario: Returns 404 when join right-source is not caller-owned

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "join"` and
  `config.secondaryInput` source-kind, referring to a data source the caller does not own
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
`200 OK` with `{ "removedTailStepCount": <integer> }` on success (HEL-906 task 3.2). **BREAKING**:
this was previously `204 No Content` with no body; existing callers that assert an exact `204`
status must be updated to accept `200` instead. `removedTailStepCount` is the splice-on-delete
report: when the deleted step was a branch point (had more than one direct child), its
FIRST child (by sibling `position`) is promoted onto the deleted step's own slot, and every OTHER
child (a tail) plus that tail's full descendant subtree is removed outright —
`removedTailStepCount` is the count of those additionally-removed descendant steps. `0` for the
common case (deleting a trunk step, or a childless tail leaf); only a genuine branch point can
ever remove more than the target step itself.

Known consumers of the prior `204` response (`frontend/src/features/pipelines/services/
pipelineService.ts`'s `deletePipelineStep`, `helio-mcp/src/helioApi.ts`'s `deletePipelineStep`)
both discard the response body/status beyond "the request succeeded" — neither reads `204`
specifically nor parses a response body — so this change is **not observed to break either
consumer at runtime**; it is a contract-shape change with no functional-break follow-up filed for
that reason. (Contrast with the `pipeline-shapes/:id/expand` envelope change, whose consumers DO
parse the response body and DO break — see the `pipeline-shape-registry` delta and HEL-934.)

#### Scenario: Existing step is deleted

- **WHEN** `DELETE /api/pipeline-steps/:id` is called for an existing step with no children (or
  exactly one child)
- **THEN** the step is removed from the database and the response is
  `200 OK` with `{ "removedTailStepCount": 0 }`

#### Scenario: Deleting a branch point reports the removed-tail-step count

- **WHEN** `DELETE /api/pipeline-steps/:id` is called for a step with two direct children, where
  the second child (a tail) itself has one child of its own
- **THEN** the response is `200 OK` with `{ "removedTailStepCount": 2 }` — the first child is
  promoted onto the deleted step's slot; the second child and its own child are both removed

#### Scenario: Returns 404 for unknown step

- **WHEN** `DELETE /api/pipeline-steps/:id` is called with a step id that does not exist
- **THEN** the response is `404 Not Found`

### Requirement: POST /api/pipelines/:id/steps appends a step against a parent or a root
Appending a step SHALL require exactly one of `parentStepId` or `rootId`. Supplying neither, both, or a `rootId` naming a root of another pipeline SHALL fail with a named error. The database SHALL enforce that a step has a root id if and only if it has no parent step, so a step cannot be persisted in a state the walk would silently skip.

#### Scenario: Appending a root-level step names its root
- **WHEN** a step is appended with `rootId` naming a root of that pipeline and no `parentStepId`
- **THEN** the step is created with that root id and appears in that root's lane

#### Scenario: Appending with neither parent nor root is rejected
- **WHEN** a step is appended with neither `parentStepId` nor `rootId`
- **THEN** the request fails with a named error and no step is created

#### Scenario: Appending with a root of another pipeline is rejected
- **WHEN** a step is appended with a `rootId` belonging to a different pipeline
- **THEN** the request fails with a named error and no step is created

#### Scenario: A parentless step with no root cannot be persisted
- **WHEN** a write would persist a step with both a null parent step id and a null root id
- **THEN** the database rejects it

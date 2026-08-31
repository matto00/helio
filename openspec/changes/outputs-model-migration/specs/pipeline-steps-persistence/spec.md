## MODIFIED Requirements

_The `pipeline-step-tree` delta (this same change) replaces the flat position-list model with a
tree (trunk plus leaf tails), keyed by `parent_step_id`; `position` is now a sibling-scoped
tiebreaker among children of the same parent, not a whole-pipeline ordering key. This delta
updates the sibling `pipeline-steps-persistence` requirement for `POST
/api/pipelines/:id/steps` to match — the wire request/response shape is unchanged, but the
`position` semantics it describes are superseded. Scenario titles are preserved verbatim from the
live spec where they still hold; only bodies affected by the position-absent behavior are
updated below. `PATCH`/`DELETE`/`GET` requirements are unaffected by this delta and are not
repeated here._

### Requirement: POST /api/pipelines/:id/steps appends a new step

The backend SHALL expose `POST /api/pipelines/:id/steps` that accepts
`{ type, config, position?, enabled? }` in the request body (where `config` is a typed object
whose shape is determined by `type`, `position` is an OPTIONAL integer index into the pipeline's
current whole-pipeline execution order, and `enabled` is an OPTIONAL boolean defaulting to true
when absent). Behavior:

- **`position` absent (default — trunk continuation):** the step is spliced onto the pipeline as
  the current trunk-last step's sole new child. It becomes the sole member of a fresh sibling
  group and its persisted `position` is always `0`, never `MAX(position)+1` — placement in
  execution order is carried by `parent_step_id`, not by a whole-pipeline-incrementing
  `position`. If the trunk-last step already has children (tail steps), those existing children
  are re-parented onto the new step, per `pipeline-step-tree`'s splice semantics, so the new step
  becomes the new trunk-last and the pre-existing tails are re-attached after it in execution
  order.
- **`position` present:** the value SHALL be validated as `0 ≤ position ≤ count` (where `count`
  is the pipeline's current step count, counted in whole-pipeline execution order); out-of-range
  values SHALL return `422 Unprocessable Entity` with no step persisted. On success the requested
  execution-order index is translated to a splice anchor (the step currently occupying that
  execution-order position becomes the new step's parent, per `pipeline-step-tree`'s splice
  semantics) and the new step's persisted `position` reflects its resulting sibling-group slot,
  not a whole-pipeline renumbering. `position = count` is equivalent to trunk continuation
  (append).
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

- **WHEN** a pipeline has 2 steps and `POST` is called with `position: 2`
- **THEN** the created step is spliced onto the current trunk-last step (identical to the
  position-absent, trunk-continuation behavior above)

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
  `config.rightDataSourceId` referring to a data source the caller does not own
- **THEN** the response is `404 Not Found`
- **THEN** no step row is inserted

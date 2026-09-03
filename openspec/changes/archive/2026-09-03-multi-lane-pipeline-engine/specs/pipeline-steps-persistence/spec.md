## MODIFIED Requirements

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

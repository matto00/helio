# pipeline-steps-persistence Delta Specification

## MODIFIED Requirements

### Requirement: POST /api/pipelines/:id/steps appends a new step

The backend SHALL expose `POST /api/pipelines/:id/steps` that accepts `{ type, config, position? }`
in the request body (where `config` is a typed object whose shape is determined by `type`, and
`position` is an OPTIONAL integer list index into the pipeline's current position-sorted step
list). Behavior:

- **`position` absent (default — the pre-existing contract, unchanged):** the step is appended
  with the next available position (MAX(position)+1 or 0 if no steps exist).
- **`position` present:** the value SHALL be validated as `0 ≤ position ≤ count` (where `count`
  is the pipeline's current step count; `position = count` is equivalent to append); out-of-range
  values SHALL return `422 Unprocessable Entity` with no step persisted. On success the step is
  inserted at that list index and every step position in the pipeline is renumbered contiguously
  (0..n) within a single database transaction — later steps shift down by one, and any
  pre-existing position gaps are healed as a side effect.

The endpoint SHALL persist the step and return the created step object with `201 Created`. When
`type` is `"join"`, the backend SHALL additionally verify that `config.rightDataSourceId` is owned
by the authenticated caller; if the source is inaccessible, the response SHALL be `404 Not Found`
and the step SHALL NOT be persisted.

#### Scenario: First step gets position 0

- **WHEN** `POST /api/pipelines/:id/steps` is called and the pipeline has no existing steps
- **THEN** the created step has `position: 0` and the response is `201 Created`

#### Scenario: Subsequent steps get incrementing positions

- **WHEN** `POST /api/pipelines/:id/steps` is called without `position` and the pipeline already
  has steps
- **THEN** the created step has `position` equal to the current maximum position plus one

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

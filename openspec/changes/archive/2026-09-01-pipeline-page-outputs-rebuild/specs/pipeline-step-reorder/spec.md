## Purpose

Narrows `PUT /api/pipelines/:id/steps/order`'s contract to trunk-only reordering (HEL-908,
design.md decision 15 / non-goal waiver #2), replacing the pre-HEL-908 "permutation of all
current step ids, position set to index" contract. Evaluation-1 cycle-2 CR2: the live capability
spec (`openspec/specs/pipeline-step-reorder/spec.md`) and the request schema still documented the
old, superseded contract; this delta corrects both on archive.

## MODIFIED Requirements

### Requirement: PUT /api/pipelines/:id/steps/order atomically reorders a pipeline's trunk
The backend SHALL expose `PUT /api/pipelines/:id/steps/order` accepting `{ "stepIds": [...] }`.
`stepIds` is a **trunk-only** contract: it must be exactly a permutation of the pipeline's
CURRENT trunk step ids — trunk = the `position == 0` chain from the pipeline root, as returned by
`trunkOf`. Any tail id present in `stepIds` is rejected (tails are attached to a node's id, not a
trunk slot, and are never reordered by this endpoint). The endpoint SHALL:
- Require editor or owner access on the pipeline (viewers receive `403 Forbidden`; pipelines the
  caller cannot see return `404 Not Found`, masking existence)
- Return `422 Unprocessable Entity` when `stepIds` is not exactly a permutation of the pipeline's
  current TRUNK step ids — a missing trunk id, an unexpected id (including any tail id), or a
  duplicate
- On success, **relink** `parentStepId` along the requested order — `stepIds[0]`'s
  `parentStepId` becomes the pipeline root (`None`), and `stepIds[i]`'s `parentStepId` becomes
  `stepIds[i - 1]` for `i > 0` — and write every trunk step's `position` as `0`, all within a
  single database transaction; a rejected (`422`) reorder SHALL leave every position and every
  `parentStepId` unchanged. A moved trunk node's own tail (if any) travels with it automatically,
  because the tail's `parentStepId` already references the trunk node's id, not a positional
  slot; the node that ends up occupying a moved node's old slot in the array does NOT inherit
  that tail.
- Return `200 OK` with the full reordered step list (same shape as `GET /api/pipelines/:id/steps`)
- Be additive: no existing endpoint, request, or response shape changes

#### Scenario: Reorder persists and survives reload
- **WHEN** a pipeline has trunk steps A, B, C (each `position == 0`, chained via `parentStepId`)
  and the owner PUTs `stepIds: [C, A, B]`
- **THEN** the response relinks the trunk as C → A → B (each step's `parentStepId` set to the
  preceding requested id, C's set to the pipeline root, and every trunk step's `position` written
  as `0`), and a subsequent `GET /api/pipelines/:id/steps` returns the same C, A, B order

#### Scenario: A trunk step's own tail follows it when the trunk is reordered
- **WHEN** a pipeline has trunk steps A, B, C and A additionally has a tail step T
  (`T.parentStepId == A.id`, `T.position >= 1`), and the owner PUTs `stepIds: [B, A, C]`
- **THEN** the response relinks the trunk to B → A → C, `T` is untouched (`T.parentStepId`
  still equals `A.id`, `T.position` unchanged) — T "follows" A to A's new slot in the trunk
  rather than staying attached to A's old array position, and B does NOT inherit T

#### Scenario: A tail id in stepIds is rejected
- **WHEN** `stepIds` names any id that is currently a tail (not a trunk step) for this pipeline
- **THEN** the response is `422 Unprocessable Entity`, naming the offending id(s) as "tail ids
  are not accepted here, only current trunk ids", and no step's position or parentStepId changes

#### Scenario: Non-permutation payloads are rejected
- **WHEN** `stepIds` omits an existing trunk step, contains an unknown id, or repeats an id
- **THEN** the response is `422 Unprocessable Entity` and no step's position or parentStepId
  changes

#### Scenario: Viewer cannot reorder
- **WHEN** a user with only viewer access PUTs a valid reorder payload
- **THEN** the response is `403 Forbidden` and no step's position changes

#### Scenario: Unknown pipeline returns 404
- **WHEN** the pipeline id does not exist or is not visible to the caller
- **THEN** the response is `404 Not Found`

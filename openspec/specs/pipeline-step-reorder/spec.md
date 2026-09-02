# pipeline-step-reorder Specification

## Purpose
Let pipeline authors reorder steps directly in the editor — by drag or keyboard — with the new order persisted atomically via a batch endpoint and the pipeline re-validated (analyze + previews) to surface any step made invalid by its new position.

## Requirements

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

### Requirement: Pipeline editor supports drag and keyboard reordering of steps
The pipeline editor SHALL let an author reorder steps and persist the result:
- Step cards SHALL be draggable to a new position (native HTML5 drag events, initiated from the
  card header area), with a visible drop indicator between cards during the drag
- Each step card SHALL offer keyboard-accessible Move up / Move down controls (accessible names,
  disabled at the first/last position) that transpose the step with its neighbor
- On drop or button activation, the new order SHALL be persisted via
  `PUT /api/pipelines/:id/steps/order` with the pipeline's persisted step ids in their new
  relative order (local-only unsaved steps are excluded from the payload); the UI SHALL reflect
  the new order immediately (optimistic), adopt the server's returned list on success, and on
  failure revert to the previous order and surface a visible error — never a silently lost
  reorder
- After a reorder settles, the pipeline SHALL re-analyze (existing debounced analyze flow) so
  per-step schemas and validation errors reflect the new order

#### Scenario: Drag reorders and persists
- **WHEN** the user drags step C above step A and drops it
- **THEN** the list immediately shows C first, the new order is persisted, and after reload the
  order is still C, A, B

#### Scenario: Keyboard reorder via Move up/Move down
- **WHEN** the user activates "Move step up" on step B (position 1)
- **THEN** B swaps with the step above it, the new order persists, and the control is disabled
  when the step reaches the first position

#### Scenario: Reorder triggers re-analyze and surfaces newly-invalid steps
- **WHEN** a step consuming a column is moved above the step that produces that column
- **THEN** the analyze refresh runs without manual action and the moved step surfaces its
  validation error through the existing per-step validation display

#### Scenario: Failed persistence reverts and surfaces an error
- **WHEN** the reorder request fails (e.g. concurrent edit made the payload stale)
- **THEN** the step list reverts to its previous order and a visible error is surfaced (no
  silently lost reorder)

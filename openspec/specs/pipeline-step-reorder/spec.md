# pipeline-step-reorder Specification

## Purpose
Let pipeline authors reorder steps directly in the editor — by drag or keyboard — with the new order persisted atomically via a batch endpoint and the pipeline re-validated (analyze + previews) to surface any step made invalid by its new position.
## Requirements
### Requirement: PUT /api/pipelines/:id/steps/order atomically reorders a pipeline's steps
The backend SHALL expose `PUT /api/pipelines/:id/steps/order` accepting `{ "stepIds": [...] }`.
The endpoint SHALL:
- Require editor or owner access on the pipeline (viewers receive `403 Forbidden`; pipelines the
  caller cannot see return `404 Not Found`, masking existence)
- Return `422 Unprocessable Entity` when `stepIds` is not exactly a permutation of the pipeline's
  current step ids (missing ids, unknown ids, or duplicates)
- On success, set each step's `position` to its index in `stepIds` within a single database
  transaction — a failed reorder SHALL leave every position unchanged
- Return `200 OK` with the full reordered step list (same shape as `GET /api/pipelines/:id/steps`)
- Be additive: no existing endpoint, request, or response shape changes

#### Scenario: Reorder persists and survives reload
- **WHEN** a pipeline has steps A, B, C (positions 0, 1, 2) and the owner PUTs
  `stepIds: [C, A, B]`
- **THEN** the response lists C, A, B with positions 0, 1, 2, and a subsequent
  `GET /api/pipelines/:id/steps` returns the same order

#### Scenario: Non-permutation payloads are rejected
- **WHEN** `stepIds` omits an existing step, contains an unknown id, or repeats an id
- **THEN** the response is `422 Unprocessable Entity` and no step's position changes

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


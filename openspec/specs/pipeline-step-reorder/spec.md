# pipeline-step-reorder Specification

## Purpose
Let pipeline authors reorder steps directly in the editor — by drag or keyboard — with the new order persisted atomically via a batch endpoint and the pipeline re-validated (analyze + previews) to surface any step made invalid by its new position.

## Requirements

### Requirement: PUT /api/pipelines/:id/steps/order atomically reorders a pipeline's trunk
The backend SHALL expose `PUT /api/pipelines/:id/steps/order` accepting `{ "stepIds": [...] }`.

`stepIds` is a **whole-pipeline trunk-only** contract (HEL-973 owner ruling): it must be exactly a
permutation of the union of **every** root's current trunk step ids — a root's trunk being the
`position == 0` chain descending from that root, as returned by `trunkOfRoot`. On a single-root
pipeline this union is that one root's trunk, so the contract is unchanged from HEL-908's. Steps
belonging to different roots MAY be interleaved in `stepIds`; that interleaving carries no semantic
weight (inter-root order is not meaningful), and the request shape carries **no** `rootId` field. Any
tail id present in `stepIds` is rejected (tails are attached to a node's id, not a trunk slot, and are
never reordered by this endpoint). The endpoint SHALL:

- Require editor or owner access on the pipeline (viewers receive `403 Forbidden`; pipelines the
  caller cannot see return `404 Not Found`, masking existence)
- Return `422 Unprocessable Entity` when `stepIds` is not exactly a permutation of the union of the
  pipeline's current trunk step ids across all roots — a missing trunk id, an unexpected id (including
  any tail id), or a duplicate
- **Preserve every step's root membership.** A step's **owning root** is the root whose trunk chain the step
  is reachable on — *not* the `root_id` column, which V98
  (`CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))`) makes a **head marker** carried by exactly the
  one parentless head step of each root. For every step named in `stepIds`, its owning root after the call
  SHALL equal its owning root before the call: reorder permutes position only and SHALL NEVER move a step
  between roots. The head marker itself legitimately moves *within* a root when the order change makes a
  different step that root's head; the invariant on the column is that **each root SHALL have exactly one
  head step, parentless and carrying that root's own id**, before and after. Membership invariance holds by
  construction: the requested order is partitioned by each step's *current* owning root, and each root's
  subsequence is relinked as that root's own chain — the pipeline's roots are never resolved to a single
  "the root".
- On success, **relink** `parentStepId` **per root**: within each root's subsequence of `stepIds` (in the
  order given), the first step's `parentStepId` becomes `None` and its `root_id` becomes **that root's own
  id**, and each subsequent step's `parentStepId` becomes its predecessor *within the same root's
  subsequence* with a `NULL` `root_id`. Every trunk step's `position` is written as `0`. All of this occurs
  within a single database transaction; a rejected (`422`) reorder SHALL leave every position, every
  `parentStepId` and every `root_id` unchanged.
- Leave tails untouched: a moved trunk node's own tail travels with it automatically, because the tail's
  `parentStepId` already references the trunk node's id, not a positional slot; the node that ends up
  occupying a moved node's old slot does NOT inherit that tail.
- Return `200 OK` with the full reordered step list (same shape as `GET /api/pipelines/:id/steps`)
- **No longer reject a multi-root pipeline.** HEL-913's fail-closed `400` for a pipeline with more than one
  root is removed; a multi-root reorder is real, specified behaviour.

#### Scenario: Reorder persists and survives reload
- **WHEN** a pipeline has trunk steps A, B, C (each `position == 0`, chained via `parentStepId`)
  and the owner PUTs `stepIds: [C, A, B]`
- **THEN** the response relinks the trunk as C → A → B (each step's `parentStepId` set to the
  preceding requested id, C's set to `None` and carrying the root's own id, and every trunk step's
  `position` written as `0`), and a subsequent `GET /api/pipelines/:id/steps` returns the same C, A, B order

#### Scenario: A trunk step's own tail follows it when the trunk is reordered
- **WHEN** a pipeline has trunk steps A, B, C and A additionally has a tail step T
  (`T.parentStepId == A.id`, `T.position >= 1`), and the owner PUTs `stepIds: [B, A, C]`
- **THEN** the response relinks the trunk to B → A → C, `T` is untouched (`T.parentStepId`
  still equals `A.id`, `T.position` unchanged) — T "follows" A to A's new slot in the trunk
  rather than staying attached to A's old array position, and B does NOT inherit T

#### Scenario: A two-root reorder applies each root's order within that root
- **WHEN** a pipeline has root R1 with trunk A → B and root R2 with trunk X → Y, and the owner PUTs
  `stepIds: [B, X, A, Y]` (roots interleaved)
- **THEN** R1's trunk becomes B → A and R2's trunk becomes X → Y; B is parentless carrying `root_id = R1`,
  A's `parentStepId` is B, X is parentless carrying `root_id = R2`, Y's `parentStepId` is X, and no step of
  R2 appears anywhere in R1's chain or vice versa

#### Scenario: No step changes its owning root as a side effect of a reorder
- **WHEN** any accepted reorder is applied to a two-root pipeline
- **THEN** the complete map of step id to **owning root** (the root whose trunk chain the step is reachable
, derived by walking the parent chain to its parentless ancestor) is identical before and after the call — for every step, not merely for
  the steps whose position changed — **and** each root still has exactly one parentless head step carrying
  that root's own id

#### Scenario: A single-root pipeline is unaffected by the contract widening
- **WHEN** a pipeline has exactly one root and the owner PUTs a permutation of that root's trunk
- **THEN** the behaviour is exactly as before HEL-973 — the union of trunks is that one trunk, and the head
  step is written with that root's id

#### Scenario: A tail id in stepIds is rejected
- **WHEN** `stepIds` names any id that is currently a tail (not a trunk step of any root) for this pipeline
- **THEN** the response is `422 Unprocessable Entity`, naming the offending id(s) as "tail ids
  are not accepted here, only current trunk ids", and no step's position, parentStepId or root_id changes
  (a rejected request writes nothing at all, so the head-marker column is unchanged too)

#### Scenario: A partial payload omitting another root's trunk is rejected
- **WHEN** `stepIds` names only one root's trunk on a two-root pipeline, omitting the other root's trunk ids
- **THEN** the response is `422 Unprocessable Entity` for the missing trunk ids and nothing is changed

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
  relative order. The payload SHALL be the **trunk step ids of every root** — for each root,
  the ids on that root's `position == 0` root-level chain and no others (local-only unsaved steps excluded,
  and no tail id, which the endpoint rejects) — rather than one root's ids, so that a multi-root pipeline
  satisfies the endpoint's whole-pipeline permutation contract instead of being rejected for the omitted
  roots. The UI SHALL
  reflect the new order immediately (optimistic), adopt the server's returned list on success, and on
  failure revert to the previous order and surface a visible error — never a silently lost reorder
- After a reorder settles, the pipeline SHALL re-analyze (existing debounced analyze flow) so
  per-step schemas and validation errors reflect the new order

#### Scenario: Drag reorders and persists
- **WHEN** the user drags step C above step A and drops it
- **THEN** the list immediately shows C first, the new order is persisted, and after reload the
  order is still C, A, B

#### Scenario: Reorder on a multi-root pipeline sends every root's lane
- **WHEN** the user reorders a step within one root's lane on a pipeline with two roots
- **THEN** the persisted payload contains the trunk step ids of both roots, and the request succeeds
  rather than returning `422` for the omitted root's ids

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

## MODIFIED Requirements

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

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop reordering is on the spine: drag the row's grip (neutral drop indicator) or use "Move up"/"Move down" in the row menu (accessible names "Move step up in <source>"/"Move step down in <source>"); the persisted ids sent are unchanged and a failed reorder reverts with an error toast.

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

#### Scenario: Desktop keyboard reorder
- **WHEN** the user chooses "Move down" on step 1 in the row menu on desktop
- **THEN** the order changes optimistically, the PUT carries the persisted ids and focus moves to the moved row

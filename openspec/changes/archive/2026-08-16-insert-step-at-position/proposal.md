# Proposal: insert-step-at-position

## Why

Adding a step mid-pipeline today means appending it and then drag-reordering it into place (or,
pre-HEL-407, delete-and-re-add everything after it). Authors think in terms of "insert a cast
between these two steps" — the editor should support that directly. All the machinery exists:
`position` on `pipeline_steps`, the create endpoint, and (since HEL-407) the page's optimistic
local-state step handling plus order-driven analyze/preview refresh.

## What Changes

- **Backend (additive field, no new endpoint — the ticket's option A):** `CreatePipelineStepRequest`
  gains `position: Option[Int]`, interpreted as a **list index** into the current sorted order
  (0 = first, count = append). Absent → exact current append behavior. Present → validated
  (`0 ≤ position ≤ count`, else 422) and inserted via a new transactional repository method that
  builds the full new order and renumbers every position 0..n from scratch — correct and
  gap-healing even though `deleteStep` leaves gaps today. All existing type/config/ACL checks
  unchanged. New `schemas/create-pipeline-step-request.schema.json` (per the AC; none exists).
- **Frontend:** an "insert step here" affordance in each gap between step cards and before the
  first, opening the existing `OpDropdown` at that gap; a page-local `handleInsertStep(opType,
  index)` generalizes `handleAddStep` (optimistic splice at index → create with `position=index`
  → reconcile from response; failure keeps the temp step + toast, mirroring the existing append
  failure convention). Append path (bottom button) unchanged. Analyze + open-preview refresh come
  free via the existing order-sensitive fingerprints.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-steps-persistence`: the "POST /api/pipelines/:id/steps appends a new step" requirement
  becomes "creates a new step (append by default, insert-at when `position` is provided)".
- `pipeline-editor-page`: gains a requirement for the insert-between-cards affordance.

## Impact

- Backend: `PipelineStepProtocol.scala` (field + format), `PipelineService.addStep` (validation +
  insert-at branch), `PipelineStepRepository` (new transactional insert-at), tests; new schema
  file. No migration, no enum change, no wire break (optional field only).
- Frontend: `PipelineDetailPage.tsx` (insert handler), `PipelineRiverView.tsx` (gap affordances),
  `pipelineService.ts` (optional position param), CSS, tests.

## Non-goals

- Drag-reorder (HEL-407, shipped) or DAG/branching.
- A separate insert-at endpoint (the optional field is strictly simpler and the ticket allows it).
- Renumbering-on-delete (gap healing happens incidentally on insert/reorder; delete semantics
  unchanged).

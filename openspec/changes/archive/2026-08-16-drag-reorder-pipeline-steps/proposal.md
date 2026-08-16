# Proposal: drag-reorder-pipeline-steps

## Why

Reordering pipeline steps today means delete + re-add — destructive (config lost) and slow. The
backend already models `position` on `pipeline_steps`; the editor already re-analyzes on step
changes. HEL-407 (epic HEL-339) adds drag + keyboard reorder with persisted order, re-validation,
and preview refresh.

## What Changes

- **Backend (additive)**: new `PUT /api/pipelines/:id/steps/order` endpoint (`{stepIds: [...]}`)
  that transactionally sets `position = index` for the pipeline's steps and returns the reordered
  list. Rationale: the existing per-step PATCH writes a raw `position` with no sibling shifting
  and no cross-request transaction — a mid-sequence failure leaves duplicate positions and a
  silently wrong execution order. That is the "per-step PATCH proves insufficient for a clean
  atomic reorder" case the ticket pre-authorizes. Editor/owner ACL, set-equality validation of
  `stepIds` vs the pipeline's current steps, thin route shell in `PipelineStepRoutes`, plus the
  matching JSON schema (schemas/ drift gate).
- **Frontend**: drag-to-reorder step cards via native HTML5 drag events (no new dependency) with
  a drop indicator, plus per-card Move up / Move down buttons for keyboard access. A page-local
  `handleReorderSteps` handler in `PipelineDetailPage` (the page owns steps as local state; every
  existing step mutation is local `setSteps` + a plain service call, not a thunk): optimistic
  reorder, new plain `reorderPipelineSteps` service call, reconcile from the response on success,
  revert + toast on failure. Analyze refresh comes free (the existing steps fingerprint is
  order-sensitive); open previews refresh by extending HEL-404's preview fingerprint with the
  step's list index (the UI `Step` type has no `position` field).

## Capabilities

### New Capabilities

- `pipeline-step-reorder`: atomic batch reorder endpoint + drag/keyboard reorder UX with
  re-validation and preview refresh.

### Modified Capabilities

- `pipeline-step-preview`: one requirement grows — the preview refresh trigger now includes the
  step's persisted position (reorder), not only its config.

## Impact

- Backend: `PipelineStepRoutes.scala`, `PipelineService.scala`, `PipelineStepRepository.scala`,
  `PipelineStepProtocol.scala`, new schema file; no migration (`position` exists), no wire break.
- Frontend: `PipelineDetailPage.tsx` (reorder handler), `PipelineRiverView.tsx` (drag
  orchestration), `StepCard.tsx` (header restructure + fingerprint), `pipelineService.ts`, CSS,
  tests. No Redux slice changes.

## Non-goals

- DAG/branching (separate epic) — linear order only.
- A drag-and-drop library dependency.
- Reordering panels/dashboards or any non-pipeline-step surface.

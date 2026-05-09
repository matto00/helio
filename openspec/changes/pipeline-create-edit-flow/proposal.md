## Why

The pipeline editor page (`/pipelines/:id`) and create modal already exist as scaffolds, but users
have no way to actually create a new pipeline with a name and source, or load and edit an existing
one with unsaved-changes protection. This gap blocks any meaningful pipeline authoring workflow.

## What Changes

- `CreatePipelineModal` is extended: the create flow wires name + source fields to
  `POST /api/pipelines` and navigates to `/pipelines/:id` on success.
- A new `/pipelines/:id/edit` route (or the existing detail page promoted to an edit-capable view)
  loads pipeline metadata via `GET /api/pipelines/:id` and its steps via
  `GET /api/pipelines/:id/steps` into the editor form.
- Save calls `PATCH /api/pipelines/:id` (and step mutations) and returns to `/pipelines` on success.
- Cancel checks dirty state; if dirty, shows a confirmation prompt before discarding.
- `beforeunload` event fires when navigating away with unsaved changes.
- Loading and error states (spinner / error message) are handled throughout.
- Unit tests cover all new and extended components.

## Capabilities

### New Capabilities

- `pipeline-edit-flow`: Edit an existing pipeline — load metadata + steps, mutate, save/cancel with
  dirty-state detection and `beforeunload` guard.

### Modified Capabilities

- `pipeline-create-modal`: Extend the create modal to call `POST /api/pipelines`, navigate to the
  new pipeline on success, and show an error on failure (requirement-level addition).
- `pipeline-editor-page`: Promote the scaffold into a full edit-capable page that loads pipeline
  data on mount and supports save/cancel (requirement-level additions).

## Impact

- Frontend: `pipelinesSlice` (new thunks for fetch-by-id, update, step fetch), `CreatePipelineModal`,
  `PipelineDetailPage` / new `PipelineEditPage`, routing config, new hook for dirty-state tracking.
- Backend: `GET /api/pipelines/:id` endpoint required if not yet present; `PATCH /api/pipelines/:id`
  must exist. These may already be partially implemented; the spec will define the contract.
- No schema migrations required (steps and pipelines tables exist from prior work).
- No breaking API changes.

## Non-goals

- Actual step execution / run pipeline (placeholder only, per existing spec).
- Drag-and-drop step reordering.
- Pipeline duplication or deletion from the edit view.

## Why

HEL-1684 made the step-structure actions draftable, but HEL-1631's block still disables every Output action and shapes
while a draft is open ("Save or discard your draft first"). A user who is reshaping a pipeline in a draft cannot add the
Output the new shape is for, edit an Output's config against the draft's columns, or drop an Output, without saving or
discarding first. The atomic save (`POST /api/pipelines/:id/draft/save`, `DraftDiff.planOutputs`) already accepts Output
create, edit and delete, including an Output on a step that is new in the draft (`nodeStepClientId`).

Owner rulings on HEL-1733: one PR covers Outputs AND shapes (`one-pr`); a draft Output delete keeps the editor sheet's
two-click confirm and Save & run then shows the existing cascade dialog (`inline-confirm-then-save-dialog`).

## What Changes

- While a draft is open, Output create, edit and delete become draft entries instead of being blocked, including an
  Output on a step that is new in the draft. With no draft open, each keeps its current immediate behavior.
- The draft overlay goes to version 3: the op log gains Output ops (create, delete) and the overlay gains an Output edit
  map, alongside the step ops and config/enabled maps. A kept v2 (and v1) draft still restores.
- The Output editor sheet is draft-aware: while a draft exists, its columns, their types and the per-kind binding
  capabilities come from the server's projection of the DRAFT at its node (the existing read-only
  `POST /api/pipelines/analyze-proposal` over the unsaved draft definition, turned into capabilities by a client port of
  the server's `buildNodeCapabilities`/`OutputBindingSpec`, held to the server by a shared parity fixture), never inferred
  from rows; its preview comes from the draft rows of its node. Its Save records the draft entry.
- The spine's Outputs section and the Live Output column show the draft's Outputs (new, edited, deleted).
- A draft Output delete removes the Output's bound panels and alert rules at Save, exactly as today's immediate delete
  does: the sheet's two-click "Confirm delete (removes from N dashboards)" records the delete, and Save & run shows the
  existing "This save removes other things" dialog listing the Output, its panels and its alert rules.
- Shapes ("Add Outputs from a shape") and "Add as tail with aggregate" become draftable: a shape records a chain of
  insert ops plus Output create ops; the aggregate tail records a lane op plus an Output create op.
- Backend: `DraftDiff.planOutputs` validates a draft Output edit as a change against the STORED config (today's PATCH
  tolerance rule), so an Output carrying stored legacy keys no longer 400s in a draft save; a restore (undo) validates
  with the restore policy, as patch-set rollback does.
- Root add/remove stays blocked during a draft with the same reason (HEL-1734).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pipeline-draft-mode-ui`: the draft carries Output create/edit/delete, shapes and the aggregate tail; the blocked set
  shrinks to roots; the Output editor sheet and the Live Output column read the draft; kept-draft v3 with v2/v1 restore.
- `pipeline-draft-save`: a draft Output edit is validated against the stored config like `PATCH /api/outputs/:id`.

## Impact

Frontend: `features/pipelines/state/pipelineDraft.ts`, `state/draftOps.ts`, `state/keptDraft.ts`, a new
`state/draftOutputs.ts` and `state/nodeCapabilities.ts`, `hooks/usePipelineDraft.ts`, `hooks/usePipelineDraftRouting.ts`,
`hooks/draftSaveRequest.ts`, `hooks/usePipelineOutputSheets.ts`, the shape and aggregate-tail hooks, `ui/outputEditor/*`,
`ui/spine/SpineOutputs.tsx`, `ui/spine/PipelineSpine.tsx`, `ui/mobile/MobilePipelineHeader.tsx`, `ui/liveOutput/*`.
Backend: `services/pipelines/draft/DraftDiff.scala` (Output edit validation) and its spec, plus a Scala test that
generates/asserts the capabilities parity fixture. New e2e spec. No schema or migration change.

## Non-goals

- Roots in a draft (HEL-1734).
- Changing any action's behavior when no draft is open.
- Moving an Output to another node or changing its kind (neither the sheet nor the save allows it today).
- Any Flyway migration.

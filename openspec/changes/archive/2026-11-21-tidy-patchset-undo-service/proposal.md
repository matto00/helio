## Why

HEL-1720 and HEL-1795 made undo refuse whenever an added lane carries Outputs or placements the patch set did not
create, so the `removedPlacementCount` an added-lane undo still reports is always 0 and its canonical requirement
(`patch-set-lane-edits`) still describes the retired cascade. `PatchSetUndoService` has grown to 426 lines, and the
later undo lanes left several small readability defects and two untested guards.

## What Changes

- Remove `removedPlacementCount`: a restored `pipelineStep` create-undo now carries no `resultingState`, the same as
  every other restored create-undo and as the undo response schema already describes. The pre-delete count read goes.
- Correct the stale cascade comments (`PatchSetUndoLaneSpec`, the `restorePipelineStepCreate` doc).
- Split `PatchSetUndoService` without changing behaviour (no test assertion changes during the split).
- Tidy: wrap the 290-character `dataSource` create arm; replace the apply loop's `ConcurrentHashMap` with an immutable
  accumulator; correct the capture-failure warning to name roots; align `doomedOutputIds`; correct the root-naming
  comment.
- Add two guard tests: a form panel bound to an inline root that has later work keeps the source (`kept`) and the
  undo succeeds; inline roots the pipeline create made are excused.

## Capabilities

### New Capabilities

### Modified Capabilities
- `patch-set-lane-edits`: undoing an added lane no longer reports a placement count, and the requirement states the
  refusal rules HEL-1720/HEL-1795 introduced instead of the retired cascade.

## Impact

- Backend: `services/patchsets/PatchSetUndoService.scala` (+ new sibling file(s)), `PatchSetApplyService.scala`,
  `PatchSetUndoBoundPanels.scala`, `PatchSetUndoLaterChildren.scala`; undo specs.
- Wire: `POST /api/patch-sets/:id/undo` drops `resultingState: {removedPlacementCount: 0}` from a restored
  `pipelineStep` create-undo. The JSON schema already says `resultingState` is absent there; neither the web client
  nor helio-mcp reads it. No migration.

## Non-goals

- Changing any refusal rule or message, or the accepted residual race window at `ifStillUnbound`.
- `PipelineStepRepository.deleteInternal`'s `Option[Int]` (a removed-STEP count misnamed in its doc as
  `removedPlacementCount`; internal, never on the wire) — noted in the PR, not changed here.
- Frontend, helio-mcp, schema file edits (none needed).

## Why

`upsertsource`'s config model, cycle detection, and engine execution all shipped (HEL-1099/1100/1101),
but the pipeline editor still renders it as a read-only "Unsupported step" notice and no MCP tool
documents its config shape — an agent or a human cannot actually create or edit one, so the feature
is invisible end to end despite being fully implemented underneath.

## What Changes

- Add a real `upsertsource` step-card editor to the pipeline editor: target picker (existing
  writable dataset, or new-source name) + append/replace mode toggle, replacing the interim
  "Unsupported step" notice for this kind only.
- Add default/seed config and narrowing so a created `upsertsource` step round-trips through the
  editor like every other op kind.
- Document `upsertsource`'s config contract in helio-mcp's `add_pipeline_step` (and
  `update_pipeline_step`, if applicable) tool descriptions, matching the `pipeline-upsertsource-config`
  spec exactly, including the ownership-check and cycle-rejection behavior.

## Capabilities

### New Capabilities

- `pipeline-upsertsource-editor`: the frontend step-card editor contract for `upsertsource` — target
  picker semantics (no silent default selection, writable-only listing), mode toggle, destructive-
  replace confirmation, and cycle/ownership error surfacing.

### Modified Capabilities

(none — `pipeline-upsertsource-config`, `pipeline-cycle-detection`, and `pipeline-upsertsource-execution`
describe backend contracts already fully implemented; this change consumes them without altering
their requirements.)

## Impact

- `frontend/src/features/pipelines/state/stepNarrowing.ts` (OP_TYPES, seed config, narrowing)
- `frontend/src/features/pipelines/ui/StepOpEditor.tsx` (dispatch)
- New `frontend/src/features/pipelines/ui/stepConfigs/UpsertSourceConfig.tsx`
- `helio-mcp/src/tools/write.ts` (`add_pipeline_step`, `update_pipeline_step` descriptions)
- **Backend fix, added mid-execution (driver-ruled, see design.md "Backend fix" section):**
  `PipelineService.classifyDbError` (`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`,
  ~line 2340) gains a `case PipelineCycleGuard.PipelineCycleRejected(msg) => ServiceError.BadRequest(msg)`
  arm, so every `.recover { case ex => Left(classifyDbError(ex)) }` fallback site (addStep,
  updateStep, duplicateStep, proposal-apply, and others) surfaces a named-cycle `400` instead of a
  generic `500` — closing a gap in already-Done HEL-1101/HEL-1100's own claimed end-to-end coverage.
  No migration; behavior-preserving for every non-cycle error path.

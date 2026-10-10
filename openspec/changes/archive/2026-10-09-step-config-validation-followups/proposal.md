## Why

HEL-1402 left four loose ends in step-config validation (see ticket.md). A patch-set `pipelineStep` create edit with a
config every other surface rejects still passes preview and resolve, and only fails at apply as an HTTP 200 carrying a
`failure` — so preview lies. The same `validateRawConfig` lookup is hand-copied at six sites. A `compute` step with no
`type` (the type is documented optional and ignored by the engine; both stored dev compute steps lack it) analyzes as a
generic "compute config error" even when its expression is fine. One test and one spec Purpose are looser than the
behaviour they describe.

## What Changes

- Patch-set `pipelineStep` create edits run the strict step-config check at resolve time: apply and preview both return
  422 `edit N: <message>` (the shape a `pipelineStep` update edit already returns) before any edit applies.
- One shared helper replaces the six hand-copied `validateRawConfig` lookups; behaviour unchanged.
- Analyze treats a `compute` config's `type` as optional: a valid expression projects its inferred type; an invalid one
  reports the specific expression problem rather than "compute config error".
- The aggregate single-call-create test asserts the step-id prefix and the rejected value; the
  `pipeline-step-config-rejection` Purpose is widened to match its requirements.
- `PipelineService.scala` split is **filed as HEL-1463**, per the ticket's own allowance (see design.md D5).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-step-config-rejection`: patch-set `pipelineStep` create edits join the surfaces rejected at resolve/preview.
- `pipeline-analyze-api`: a `compute` step with no `type` is analyzed on its merits.

## Impact

Backend only: `services/patchsets/PatchSetApplyResolvers.scala`, `services/pipelines/PipelineService.scala`,
`services/pipelines/PipelineProposalService.scala`, `domain/model/PipelineStep.scala`,
`domain/engine/ColumnSchemaInference.scala` (+ tests). No migration, no wire-shape change beyond the earlier 422.

## Non-goals

- Rejecting a `compute` config with no `type` at save (would invalidate every stored dev compute step).
- Splitting `PipelineService.scala` (HEL-1463).
- Changing unknown-step-type handling for patch-set step-create (stays apply-time 400 `failure`, as today).

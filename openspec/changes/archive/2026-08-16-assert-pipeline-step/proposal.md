## Why

Pipelines produce the DataTypes panels bind to, but nothing lets a pipeline declare expectations about
its own output — no automated analog of manual data fact-checking. HEL-419 (epic) adds pipeline
assertions in stages; this ticket (419-A) lands the assertion rule model and a pass-through `assert`
pipeline step so rules can be authored, persisted, and schema-analyzed. Rule *evaluation* is 419-B.

## What Changes

- New backend step module `AssertStep.scala`: `AssertConfig` (a rule vector), `AssertRule` (kind,
  optional field, params, severity), six v1 rule kinds (`notNull`, `unique`, `range`, `rowCountMin`,
  `rowCountMax`, `regex`), tolerant `decode`, and the `PipelineStep.Companion`.
- Register `assert` in `PipelineStep.Registry` / `PipelineStepKind`.
- Flyway migration extending `pipeline_steps_op_check` to accept `'assert'` (drop/re-add pattern).
- `PipelineAnalyzeService.inferOutputSchema` gains an `"assert"` case: identity output schema, with a
  `validationError` when a rule's `kind`/`severity` is invalid or a field-requiring rule's `field` is
  absent from the input schema.
- Frontend `AssertConfig.tsx` editor (add/remove rules; kind/field/params/severity per row), wired into
  `StepCard.tsx`, `OpDropdown.tsx`'s `OP_TYPES`, and the pipeline step type unions.
- `evaluate` is an identity pass-through — no rows are dropped or altered by this ticket.

## Capabilities

### New Capabilities

- `pipeline-assert-op`: the `assert` pipeline step — rule model, persistence, schema-inference
  pass-through, and its editor UI.

### Modified Capabilities

(none — this is an additive op, following the same pattern as `pipeline-lookup-op` /
`pipeline-split-text-op` / `pipeline-union-op`, each landed as its own new capability)

## Impact

- Backend: `domain/steps/AssertStep.scala` (new), `domain/PipelineStep.scala`,
  `domain/package.scala`, `domain/PipelineAnalyzeService.scala`,
  `api/protocols/PipelineStepConfigCodec.scala`, `api/protocols/PipelineStepProtocol.scala`,
  `api/protocols/PipelineAnalyzeProtocol.scala` (defines `AssertAnalyzeStepResponse` + its wire
  dispatch — distinct from `PipelineStepProtocol.scala`'s ordinary step response),
  `infrastructure/PipelineStepRepository.scala`, `services/PatchSetPreviewProjectionSteps.scala`,
  `services/PipelineService.scala` (constructs the analyze response), one new Flyway migration.
- Frontend: `features/pipelines/types/pipelineStep.ts`, `features/pipelines/ui/AssertConfig.tsx` (new),
  `features/pipelines/ui/StepCard.tsx`, `features/pipelines/state/stepNarrowing.ts`,
  `features/pipelines/hooks/useStepCardState.ts`.
- No API route changes, no ACL changes (assert never touches a second DataSource), no MCP tool changes
  (419-F).

## Non-goals

- Rule evaluation / per-run pass-fail persistence (419-B).
- Fail policy / blocking the DataType update on a failed rule (419-C).
- `referential` cross-DataType assertions (future, not in the v1 rule set).
- `add_pipeline_step` MCP tool wiring (419-F).

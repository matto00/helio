# Files modified — HEL-454 (assert-pipeline-step)

## Backend — new

- `backend/src/main/scala/com/helio/domain/steps/AssertStep.scala` — `AssertRule`/`AssertConfig` case classes, tolerant `AssertConfig.decode`, the `AssertStep` case class (identity `evaluate`), and its `PipelineStep.Companion`.
- `backend/src/main/resources/db/migration/V82__add_assert_op.sql` — extends `pipeline_steps_op_check` to accept `'assert'` (drop/re-add pattern; V82 confirmed as the next available migration number at execution time).
- `backend/src/test/scala/com/helio/domain/steps/AssertStepSpec.scala` — `AssertConfig.decode` tolerance tests (missing `rules`, malformed rule entries, non-object elements/params) and an `AssertStep.evaluate` identity-pass-through test.

## Backend — modified

- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registers `AssertStep.Kind` in `PipelineStep.Registry` and adds `PipelineStepKind.Assert`.
- `backend/src/main/scala/com/helio/domain/package.scala` — re-exports `AssertStep`/`AssertRule`/`AssertConfig` type + val aliases.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — adds a dedicated `"assert"` dispatch case (`inferAssert`): identity output schema always, aggregated `validationError` for invalid kind/severity/missing-or-unknown field (field-required kinds only).
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` — `AssertConfig`/`AssertStep` imports + `encodeConfig`/`extractConfig` match arms.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — `AssertStepResponse`, its `jsonFormat6`, and its write/read dispatch arms (ordinary step response).
- `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` — declares `AssertAnalyzeStepResponse` (the analyze-response type, distinct from the ordinary step response above), its `jsonFormat6`, and its write/read dispatch arms.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — row-decode arm for `AssertConfig` → `AssertStep`.
- `backend/src/main/scala/com/helio/services/PatchSetPreviewProjectionSteps.scala` — position-copy and config-update match arms for `AssertStep`/`AssertConfig`.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — constructs `AssertAnalyzeStepResponse` in the analyze response assembly (no ACL pre-flight needed — assert has no second-source reference).
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — adds `assertStep` to the ADT parity/exhaustiveness tests.
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — `assert` inference tests (identity schema, unknown field, invalid kind, invalid severity, rowCountMin/Max field-exemption, multi-rule aggregation, malformed config).
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — `assert` codec round-trip, decode-tolerance, and encode-round-trip coverage.

## Frontend — new

- `frontend/src/features/pipelines/ui/AssertConfig.tsx` — rule-row editor (kind/field/params/severity per row, add/remove) for the `assert` step.
- `frontend/src/features/pipelines/ui/AssertConfig.test.tsx` — add/remove rule, per-kind field show/hide, params inputs per kind, onChange payload, and hydration coverage.

## Frontend — modified

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `AssertRule`/`AssertConfig`/`AssertStep`/`AssertAnalyzeStep` types, added to the `PipelineStep`/`PipelineStepConfig`/`AnalyzeStepResult` unions.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `assert` entry in `OP_TYPES`, `defaultConfigFor("assert")`, and the `assertConfigOf` narrowing helper.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — `assertConfig` state + `onAssertChange` handler, wired through `persist`.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — imports `AssertConfig` and renders it for `step.opType.id === "assert"`.

## Schema

- `schemas/pipeline-proposal.schema.json` — appends `assert` to the descriptive (non-enforced) op-list doc string.

## Backend

- `backend/src/main/resources/db/migration/V69__add_fillnull_op.sql` — new migration extending
  `pipeline_steps_op_check` to accept `'fillnull'` (drop/re-add pattern, confirmed V69 is next-free
  both before writing and immediately before delivery).
- `backend/src/main/scala/com/helio/domain/steps/FillNullStep.scala` — new step module:
  `FillNullConfig` (tolerant decode), `FillNullStep` case class/`evaluate`, and the five strategy
  implementations (`constant`/`forwardFill`/`mean`/`median`/`mode`) plus `companion`.
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registered
  `FillNullStep.companion` in `PipelineStep.Registry` + `PipelineStepKind.FillNull`.
- `backend/src/main/scala/com/helio/domain/package.scala` — re-exported `FillNullStep`/
  `FillNullConfig` from `com.helio.domain.steps`.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — added `"fillnull"` to
  the true identity-passthrough dispatch arm (`filter`/`limit`/`sort`/`dedupe`/`fillnull`), verified
  against the actual dispatch code (not `cast`, which has its own `inferCast` arm — per the
  design-gate skeptic note).
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — `FillNullStepResponse`
  + `jsonFormat6` + union read/write arms + `fromDomain` case.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` —
  `encodeConfig`/`extractConfig` arms for `FillNullConfig`/`FillNullStep`.
- `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` —
  `FillNullAnalyzeStepResponse` + union read/write arms.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — `rowToDomain`
  arm for `FillNullConfig`.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — `toAnalyzeStepResponse` arm
  for `FillNullConfig`.

## Backend tests

- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — round-trip
  execution coverage per strategy, missing-`value` failure, unsupported-strategy failure, null vs.
  missing-key parity, columns-not-listed passthrough.
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — analyze passthrough
  test for `fillnull`.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — decode
  preserve/tolerance tests + encode round-trip case for `fillnull`.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` — added
  `FillNullStepResponse` to the discriminated-union round-trip subtype list.
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — kind-parity + exhaustive-match
  coverage updated for `FillNullStep`/`PipelineStepKind.FillNull`.

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `FillNullConfig`/`FillNullStep`/
  `FillNullAnalyzeStep` wire types + union entries (4-addition pattern, matching `DedupeConfig`).
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `OP_TYPES` entry, `defaultConfigFor`
  case, `fillNullConfigOf` narrowing helper.
- `frontend/src/features/pipelines/ui/FillNullConfig.tsx` — new editor component (columns
  checklist, strategy dropdown, conditional constant-value input).
- `frontend/src/features/pipelines/ui/FillNullConfig.test.tsx` — co-located tests (column
  toggle, strategy selection, conditional value input, onChange payloads).
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — `fillNullConfig` state +
  `onFillNullChange` handler.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — wired `FillNullConfig` into the step-card
  body dispatch.

## MCP

- `helio-mcp/src/tools/write.ts` — documented `fillnull` in `add_pipeline_step`'s description
  string (type list + config shape); no schema change (`type` is free-text `z.string()`).

# Files modified — HEL-220 extract-markdown-headings

## Backend

- `backend/src/main/scala/com/helio/domain/steps/ExtractHeadingsStep.scala` — new: `ExtractHeadingsConfig` (tolerant decode), `ExtractHeadingsStep` (flatMap evaluate), the pure `extractHeadings` extraction function, and the `PipelineStep.Companion` registration.
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registered `ExtractHeadingsStep` in `PipelineStep.Registry` and added `PipelineStepKind.ExtractHeadings`.
- `backend/src/main/scala/com/helio/domain/package.scala` — added `ExtractHeadingsStep`/`ExtractHeadingsConfig` type+value aliases so the `com.helio.domain._` wildcard import resolves them.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — added `ExtractHeadingsStepResponse`, its config/response JSON formats, and both `fromDomain`/read+write union match arms.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` — added `ExtractHeadingsConfig`/`ExtractHeadingsStep` arms to `encodeConfig` and `extractConfig`.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — added the `ExtractHeadingsConfig` arm to `rowToDomain`.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — added `inferExtractHeadings` (dispatch arm + function): field-existence + string-body-type validation, appends `indexField`/`levelField` as `"integer"` on success.
- `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala` — added `ExtractHeadingsAnalyzeStepResponse` to the separate `AnalyzeStepResponse` wire ADT (case class, format, both read/write match arms) — the site HEL-219 initially missed; covered here.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — added the `ExtractHeadingsConfig` arm to `toAnalyzeStepResponse`.
- `backend/src/main/resources/db/migration/V51__add_extractheadings_op.sql` — new: extends `pipeline_steps_op_check` to include `'extractheadings'`.

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — added `ExtractHeadingsConfig`, `ExtractHeadingsStep`, `ExtractHeadingsAnalyzeStep` types; included in the `PipelineStep`/`PipelineStepConfig`/`AnalyzeStepResult` unions.
- `frontend/src/features/pipelines/ui/ExtractHeadingsConfig.tsx` — new: field dropdown restricted to `analyzeSchema` entries with `type === "string-body"`.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — added `"extractheadings"` to `OP_TYPES` (icon `faHeading`, label), its `defaultConfigFor` seed, and the `extractHeadingsConfigOf` narrowing helper.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — wired `ExtractHeadingsConfig` into the per-op branch.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — added `extractHeadingsConfig` state + `onExtractHeadingsChange` handler.

## Tests

- `backend/src/test/scala/com/helio/domain/steps/ExtractHeadingsStepSpec.scala` — new: standalone spec covering mixed-level extraction, `\r\n` normalization, title trimming, no-heading rows, passthrough fields, null-field drop, custom field names, and name-collision "last write wins".
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — added `extractHeadings` to `allSubtypes`, `PipelineStepKind.All`, per-kind `kind` assertions, and the pattern-match exhaustiveness block (12 kinds total).
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — added `"extractheadings"` decode-preservation test and an `encodeConfig` round-trip entry.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` — added `ExtractHeadingsStepResponse` to the `subtypes` round-trip list.
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — added the `ExtractHeadingsConfig` arm to `makeStep`, plus four full-engine `extractheadings` scenarios.
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — added six `inferExtractHeadings` scenarios (valid field, unknown field, non-string-body field, missing-config defaults, collision, malformed config).
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` — added a `"POST with type 'extractheadings' is accepted"` regression test.
- `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala` — added a regression scenario asserting `GET /api/pipelines/:id/analyze` returns 200 (not 500) for an `extractheadings` step, with the expected `indexField`+`levelField`-appended output schema.
- `frontend/src/features/pipelines/ui/ExtractHeadingsConfig.test.tsx` — new: field dropdown gating (string-body only), empty-dropdown case, and config-change patching.

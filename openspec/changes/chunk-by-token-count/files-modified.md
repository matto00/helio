# Files Modified — HEL-221 (chunkbytokencount pipeline op)

## Backend — dependency + proactive split

- `backend/build.sbt` — added `com.knuddels:jtokkit:1.1.0` (real BPE tokenizer, per design.md decision 4).
- `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` (new) — extracted
  `AnalyzeStepResponse` ADT + `PipelineAnalyzeResponse` + their formats out of `PipelineProtocol.scala`
  (design.md decision 8, proactive behavior-preserving split so both files stay under the 250-line
  soft budget); also carries the new `ChunkByTokenCountAnalyzeStepResponse` subtype.
- `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala` — removed the extracted
  analyze types/formats; now `extends ... with PipelineAnalyzeProtocol` (257 → 95 lines).

## Backend — new op

- `backend/src/main/scala/com/helio/domain/steps/ChunkByTokenCountStep.scala` (new) — `ChunkByTokenCountConfig`
  (tolerant decode), `ChunkByTokenCountStep` case class, `evaluate`/`apply` (flatMap chunking), the
  pure `chunkTokens` function (jtokkit encode → chunk → decode), and the `PipelineStep.Companion`.
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registered `ChunkByTokenCountStep` in
  `PipelineStep.Registry` and added `PipelineStepKind.ChunkByTokenCount`.
- `backend/src/main/scala/com/helio/domain/package.scala` — re-exported `ChunkByTokenCountStep`/`ChunkByTokenCountConfig`.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — added
  `ChunkByTokenCountStepResponse`, its config/response formats, and both `fromDomain`/union read+write arms.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` — added
  `chunkbytokencount` arms to `encodeConfig`/`extractConfig`.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — added the
  `ChunkByTokenCountConfig` → `ChunkByTokenCountStep` arm to `rowToDomain`.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — added `inferChunkByTokenCount`
  (field-existence + string-body validation, appends `indexField`/`tokenCountField` as `"integer"`).
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — added the
  `ChunkByTokenCountConfig` → `ChunkByTokenCountAnalyzeStepResponse` arm to `toAnalyzeStepResponse`
  (the exact site that 500'd HEL-219's first cycle when missed).
- `backend/src/main/resources/db/migration/V52__add_chunkbytokencount_op.sql` (new) — extends
  `pipeline_steps_op_check` to include `'chunkbytokencount'` (13 kinds total).

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — added `ChunkByTokenCountConfig`/`ChunkByTokenCountStep`/
  `ChunkByTokenCountAnalyzeStep` types, included in the `PipelineStep`/`PipelineStepConfig`/`AnalyzeStepResult` unions.
- `frontend/src/features/pipelines/ui/ChunkByTokenCountConfig.tsx` (new) — step-card editor: string-body
  field dropdown, `targetTokenCount` numeric input, `encoding` dropdown (o200k_base/cl100k_base).
- `frontend/src/features/pipelines/ui/ChunkByTokenCountConfig.test.tsx` (new) — field-dropdown gating,
  token-count input validation, encoding default/change coverage.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — added `"chunkbytokencount"` to `OP_TYPES`
  (icon `faLayerGroup`), its `defaultConfigFor` seed, and `chunkByTokenCountConfigOf` narrowing helper.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — wired `chunkByTokenCountConfig` state +
  `onChunkByTokenCountChange` persistence handler.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — wired the `ChunkByTokenCountConfig` editor into
  the per-op branch.

## Tests

- `backend/src/test/scala/com/helio/domain/steps/ChunkByTokenCountStepSpec.scala` (new) — standalone
  chunking-logic spec: jtokkit encode/chunk/decode round trip (both encodings), chunk-size boundary
  (exact multiple vs. remainder), passthrough fields, null/empty-string row drop, custom field names,
  last-write-wins collision, non-positive `targetTokenCount` clamping, encoding-fallback decode tolerance.
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — `inferChunkByTokenCount`
  coverage (valid field, unknown field, non-string-body field, defaults, collision, malformed config).
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — added `chunkByTokenCount` to the
  ADT-shape/exhaustiveness/kind-parity tests (13 kinds total).
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — round-trip +
  encode/decode coverage for `chunkbytokencount`.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` — added
  `ChunkByTokenCountStepResponse` to the discriminated-union round-trip subtypes.
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — added the `makeStep`
  arm and full-engine round-trip scenarios (multi-chunk split, passthrough, null/empty drop, cl100k_base).
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` — added the
  `"POST with type 'chunkbytokencount' is accepted"` regression test.
- `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala` — added the
  `chunkbytokencount` analyze-200 regression scenario (the exact HEL-219-class regression this
  ticket's acceptance criteria calls out).

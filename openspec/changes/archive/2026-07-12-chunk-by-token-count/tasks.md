## 1. Backend

- [x] 1.1 Add `"com.knuddels" % "jtokkit" % "1.1.0"` to `backend/build.sbt` `libraryDependencies`.
- [x] 1.2 Extract `PipelineProtocol.scala`'s `AnalyzeStepResponse` ADT (sealed trait, all 12
      existing per-kind case classes, `PipelineAnalyzeResponse`, `analyzeStepResponseFormat`,
      `pipelineAnalyzeResponseFormat`) into new `PipelineAnalyzeProtocol.scala` (same package);
      `PipelineProtocol` becomes `extends ... with PipelineAnalyzeProtocol`. Run `sbt compile` to
      confirm the split is behavior-preserving before adding any new-op code.
- [x] 1.3 Create `backend/src/main/scala/com/helio/domain/steps/ChunkByTokenCountStep.scala`:
      `ChunkByTokenCountConfig` (`field`, `targetTokenCount` default `500`, `encoding` default
      `"o200k_base"` with fallback for unrecognized values, `indexField` default `"chunkIndex"`,
      `tokenCountField` default `"tokenCount"`) with tolerant `StepCodecUtil.asObject`-based
      `decode`; `ChunkByTokenCountStep` case class; `evaluate` (flatMap: drop null-field rows,
      tokenize via `jtokkit`, chunk the token sequence, decode each chunk, emit passthrough +
      replaced `field` + `indexField` + `tokenCountField`); the `PipelineStep.Companion` object.
- [x] 1.4 Implement the pure chunking function using `Encodings.newDefaultEncodingRegistry()` /
      `EncodingType.O200K_BASE`/`CL100K_BASE`; confirm `jtokkit`'s actual token-slice/decode API
      against the resolved jar and cover it with a round-trip unit test (task 3.1).
- [x] 1.5 Register `ChunkByTokenCountStep` in `PipelineStep.Registry` and
      `PipelineStepKind.ChunkByTokenCount = "chunkbytokencount"` in `PipelineStep.scala`; add
      `ChunkByTokenCountStep`/`ChunkByTokenCountConfig` aliases in `package.scala`.
- [x] 1.6 Add `chunkbytokencount` to `PipelineStepResponse` in `PipelineStepProtocol.scala`: new
      `ChunkByTokenCountStepResponse` case class, config format, step-response format, and both
      match arms in `fromDomain`/the read+write union.
- [x] 1.7 Add `chunkbytokencount` arms to `PipelineStepConfigCodec.extractConfig`/`.encodeConfig`.
- [x] 1.8 Add the `Success(cfg: ChunkByTokenCountConfig) => ChunkByTokenCountStep(...)` arm to
      `PipelineStepRepository.rowToDomain`.
- [x] 1.9 Add `inferChunkByTokenCount` to `PipelineAnalyzeService.scala`: field-existence +
      string-body-type validation; `indexField`/`tokenCountField` appended as `"integer"` on
      success; identity-fallback schema + `validationError` on failure.
- [x] 1.10 Add `ChunkByTokenCountAnalyzeStepResponse` to `PipelineAnalyzeProtocol.scala` (case
      class, format, both write/read match arms) and the
      `case Success(cfg: ChunkByTokenCountConfig) => ChunkByTokenCountAnalyzeStepResponse(...)`
      arm to `PipelineService.toAnalyzeStepResponse` — do not skip this site.
- [x] 1.11 Create `backend/src/main/resources/db/migration/V52__add_chunkbytokencount_op.sql`:
      drop/re-add `pipeline_steps_op_check` including `'chunkbytokencount'` (all 13 kinds).

## 2. Frontend

- [x] 2.1 Add `ChunkByTokenCountConfig`/`ChunkByTokenCountStep`/`ChunkByTokenCountAnalyzeStep`
      types to `frontend/src/features/pipelines/types/pipelineStep.ts` (config mirrors the
      backend; include in the `PipelineStep`/`PipelineStepConfig`/`AnalyzeStepResult` unions).
- [x] 2.2 Create `frontend/src/features/pipelines/ui/ChunkByTokenCountConfig.tsx`: field dropdown
      filtered to `analyzeSchema` entries with `type === "string-body"`, a numeric
      `targetTokenCount` input, and an `encoding` dropdown (`o200k_base` default / `cl100k_base`).
- [x] 2.3 Add `"chunkbytokencount"` to `OP_TYPES` in `stepNarrowing.ts` (icon, label), its
      `defaultConfigFor` seed, and a `chunkByTokenCountConfigOf` narrowing helper.
- [x] 2.4 Wire `ChunkByTokenCountConfig` into `StepCard.tsx`'s per-op branch and
      `useStepCardState.ts`'s config-change handler, passing `analyzeSchema`.

## 3. Tests

- [x] 3.1 Create standalone `ChunkByTokenCountStepSpec.scala`: encode/chunk/decode round trip for
      both encodings, chunk-size boundary (exact multiple vs. remainder), passthrough fields,
      null-field row dropped, empty-string row dropped, unrecognized-encoding fallback.
- [x] 3.2 Backend unit tests for `PipelineAnalyzeService.inferChunkByTokenCount` (valid
      string-body field, unknown field, non-string-body field).
- [x] 3.3 Update `PipelineStepSpec.scala`'s exhaustiveness test: add `chunkbytokencount` (13 kinds
      total).
- [x] 3.4 Add a `"chunkbytokencount" -> ChunkByTokenCountConfig(...)` entry to
      `PipelineStepConfigCodecSpec.scala`'s round-trip list.
- [x] 3.5 Add a `ChunkByTokenCountStepResponse(...)` entry to `PipelineStepProtocolSpec.scala`.
- [x] 3.6 Add a `makeStep` arm plus engine-level scenarios to `InProcessPipelineEngineSpec.scala`.
- [x] 3.7 Add a route-level `"POST with type 'chunkbytokencount' is accepted"` test to
      `PipelineStepRoutesSpec.scala`.
- [x] 3.8 Add a `chunkbytokencount` scenario to `PipelineAnalyzeRoutesSpec.scala` asserting
      `GET /api/pipelines/:id/analyze` returns `200` with the expected output schema.
- [x] 3.9 Frontend test for `ChunkByTokenCountConfig.tsx`: field dropdown restriction, encoding
      default/change, token-count input, empty dropdown when no string-body fields exist.
- [x] 3.10 Run `sbt test`, `npm test`, `npm run lint`, and `npm run check:scala-quality`; live
      `curl` a pipeline containing a `chunkbytokencount` step against
      `GET /api/pipelines/:id/analyze` and confirm `200` (not `500`).

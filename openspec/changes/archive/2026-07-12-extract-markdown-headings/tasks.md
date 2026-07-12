## 1. Backend

- [x] 1.1 Create `backend/src/main/scala/com/helio/domain/steps/ExtractHeadingsStep.scala`:
      `ExtractHeadingsConfig` (`field`, `indexField` default `"headingIndex"`, `levelField` default
      `"headingLevel"`) with tolerant `StepCodecUtil.asObject`-based `decode`, `ExtractHeadingsStep`
      case class, `evaluate` (flatMap: drop null-field rows, extract headings, emit one row per
      heading with passthrough fields + replaced `field` (title text) + `indexField` + `levelField`),
      and the `PipelineStep.Companion` object — mirror `SplitTextStep.scala`'s structure.
- [x] 1.2 Implement the extraction function `extractHeadings(content: String): Seq[(String, Int)]`
      as a pure function per design.md decision 4 (normalize `\r\n`, match `^#{1,6}\s+(.*)$` per
      line, return `(title, level)` pairs in document order).
- [x] 1.3 Register `ExtractHeadingsStep` in `PipelineStep.Registry` and add
      `PipelineStepKind.ExtractHeadings = "extractheadings"` in
      `backend/src/main/scala/com/helio/domain/PipelineStep.scala`. Add
      `ExtractHeadingsStep`/`ExtractHeadingsConfig` aliases to `backend/src/main/scala/com/helio/domain/package.scala`
      (required for the `com.helio.domain._` wildcard import used by repository/codec/protocol/test
      call sites — same as `splittext`'s task 1.3).
- [x] 1.4 Add `extractheadings` to `PipelineStepResponse` in `PipelineStepProtocol.scala`: new
      `ExtractHeadingsStepResponse` case class, `implicit val extractHeadingsConfigFormat`, the
      `extractHeadingsStepResponseFormat`, and both match arms in `fromDomain`/the read+write union.
- [x] 1.5 Add `extractheadings` arms to `PipelineStepConfigCodec.extractConfig` and `.encodeConfig`
      in `PipelineStepConfigCodec.scala`.
- [x] 1.6 Add the `Success(cfg: ExtractHeadingsConfig) => ExtractHeadingsStep(...)` arm to
      `PipelineStepRepository.rowToDomain`.
- [x] 1.7 Add `inferExtractHeadings` to `PipelineAnalyzeService.scala` (dispatch arm + function) per
      design.md decision 5: field-existence + string-body-type validation, `indexField` and
      `levelField` appended as `"integer"` on success, identity-fallback schema + `validationError`
      on failure.
- [x] 1.8 Add `ExtractHeadingsAnalyzeStepResponse` to `PipelineProtocol.scala`'s separate
      `AnalyzeStepResponse` ADT (case class, `jsonFormatN`, both write/read match arms) and the
      `case Success(cfg: ExtractHeadingsConfig) => ExtractHeadingsAnalyzeStepResponse(...)` arm to
      `PipelineService.toAnalyzeStepResponse` — this is the 8th enumeration site (design.md decision
      8) that HEL-219 initially missed; do not skip it here.
- [x] 1.9 Create `backend/src/main/resources/db/migration/V51__add_extractheadings_op.sql`:
      drop/re-add `pipeline_steps_op_check` including `'extractheadings'` (mirror
      `V50__add_splittext_op.sql`).

## 2. Frontend

- [x] 2.1 Add `ExtractHeadingsConfig`/`ExtractHeadingsStep`/`ExtractHeadingsAnalyzeStep` types to
      `frontend/src/features/pipelines/types/pipelineStep.ts` (config shape mirrors the backend;
      include in the `PipelineStep`/`PipelineStepConfig`/`AnalyzeStepResult` unions).
- [x] 2.2 Create `frontend/src/features/pipelines/ui/ExtractHeadingsConfig.tsx`: field dropdown
      filtered to `analyzeSchema` entries with `type === "string-body"` — mirror
      `SplitTextConfig.tsx`'s `analyzeSchema`-driven field dropdown pattern (no mode toggle needed,
      single behavior).
- [x] 2.3 Add `"extractheadings"` to `OP_TYPES` in `stepNarrowing.ts` (icon, label), its
      `defaultConfigFor` seed (`{field: "", indexField: "headingIndex", levelField:
      "headingLevel"}`), and an `extractHeadingsConfigOf` narrowing helper.
- [x] 2.4 Wire `ExtractHeadingsConfig` into `StepCard.tsx`'s per-op branch and
      `useStepCardState.ts`'s config-change handler, passing `analyzeSchema`.

## 3. Tests

- [x] 3.1 Create standalone `backend/src/test/scala/com/helio/domain/steps/ExtractHeadingsStepSpec.scala`
      covering: mixed-level heading extraction in document order, passthrough fields, null-field
      row dropped, no-heading-content row dropped.
- [x] 3.2 Backend unit tests for `PipelineAnalyzeService.inferExtractHeadings` (valid string-body
      field, unknown field, non-string-body field) per the spec's three scenarios.
- [x] 3.3 Update `PipelineStepSpec.scala`'s exhaustiveness test: add `extractheadings` to
      `allSubtypes`, `PipelineStepKind.All` assertion set, the per-kind `kind` assertions, and the
      pattern-match coverage block (12 kinds total).
- [x] 3.4 Add an `"extractheadings" -> ExtractHeadingsConfig(...)` entry to
      `PipelineStepConfigCodecSpec.scala`'s `cases` round-trip list.
- [x] 3.5 Add an `ExtractHeadingsStepResponse(...)` entry to `PipelineStepProtocolSpec.scala`'s
      `subtypes` list.
- [x] 3.6 Add a `case c: ExtractHeadingsConfig => ExtractHeadingsStep(...)` arm to
      `InProcessPipelineEngineSpec.scala`'s `makeStep` helper, plus one or two engine-level
      `extractheadings` scenarios alongside the other 11 kinds' tests in that file.
- [x] 3.7 Add a route-level `"POST with type 'extractheadings' is accepted"` test to
      `PipelineStepRoutesSpec.scala`, mirroring the existing `splittext`/`aggregate` regression
      tests — required by the `pipeline-steps-persistence` spec delta's new scenario.
- [x] 3.8 Add an `extractheadings` scenario to `PipelineAnalyzeRoutesSpec.scala` seeding a pipeline
      with an `extractheadings` step against a `string-body`-bearing source schema, asserting
      `GET /api/pipelines/:id/analyze` returns `200` with the expected output schema (`indexField`
      + `levelField` appended) — the regression test that would catch a missed
      `AnalyzeStepResponse` arm.
- [x] 3.9 Frontend test for `ExtractHeadingsConfig.tsx`: field dropdown only offers `string-body`
      fields, config-change patches, empty dropdown when no string-body fields exist.
- [x] 3.10 Run `sbt test` and `npm test` for the full suite; run `npm run lint` (zero-warnings).

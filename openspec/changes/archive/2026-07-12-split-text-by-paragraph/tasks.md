## 1. Backend

- [x] 1.1 Create `backend/src/main/scala/com/helio/domain/steps/SplitTextStep.scala`: `SplitTextConfig`
      (`field`, `mode`, `headingLevel` default `1`, `indexField` default `"segmentIndex"`) with
      tolerant `StepCodecUtil.asObject`-based `decode`, `SplitTextStep` case class, `evaluate`
      (flatMap: drop null-field rows, split per mode, emit one row per segment with passthrough
      fields + replaced `field` + `indexField`), and the `PipelineStep.Companion` object.
- [x] 1.2 Implement the two split functions (`splitParagraphs`, `splitHeadings`) as pure
      `String => Seq[String]` per design.md decision 4 (blank-line split / ATX-heading split).
- [x] 1.3 Register `SplitTextStep` in `PipelineStep.Registry` and add
      `PipelineStepKind.SplitText = "splittext"` in `backend/src/main/scala/com/helio/domain/PipelineStep.scala`.
      Also added `SplitTextStep`/`SplitTextConfig` aliases to `PipelineStep`'s package object
      (`com/helio/domain/package.scala`) — required for the `com.helio.domain._` wildcard import
      used by the repository/codec/protocol/test call sites (not explicitly called out as a 7th
      enumeration site in design.md, but load-bearing all the same).
- [x] 1.4 Add `splittext` to `PipelineStepResponse` in `PipelineStepProtocol.scala`: new
      `SplitTextStepResponse` case class, `implicit val splitTextConfigFormat`, the
      `splitTextStepResponseFormat`, and both match arms in `fromDomain`/the read+write union.
- [x] 1.5 Add `splittext` arms to `PipelineStepConfigCodec.extractConfig` and `.encodeConfig` in
      `PipelineStepConfigCodec.scala`.
- [x] 1.6 Add the `Success(cfg: SplitTextConfig) => SplitTextStep(...)` arm to
      `PipelineStepRepository.rowToDomain`.
- [x] 1.7 Add `inferSplitText` to `PipelineAnalyzeService.scala` (dispatch arm + function) per
      design.md decision 5: field-existence + string-body-type validation, `indexField` appended
      as `"integer"` on success, identity-fallback schema + `validationError` on failure.
- [x] 1.8 Create `backend/src/main/resources/db/migration/V50__add_splittext_op.sql`: drop/re-add
      `pipeline_steps_op_check` including `'splittext'` (mirror `V31__add_aggregate_op.sql`).
- [x] 1.9 (cycle 2, evaluation-1.md CR 1/2) Add `SplitTextAnalyzeStepResponse` to
      `PipelineProtocol.scala`'s separate `AnalyzeStepResponse` ADT (case class, `jsonFormat6`, both
      write/read match arms) and the `case Success(cfg: SplitTextConfig) =>
      SplitTextAnalyzeStepResponse(...)` arm to `PipelineService.toAnalyzeStepResponse` — this was
      the actual 8th enumeration site design.md decision 8 missed in cycle 1, causing
      `GET /api/pipelines/:id/analyze` to 500 for any pipeline with a `splittext` step.

## 2. Frontend

- [x] 2.1 Add `SplitTextConfig`/`SplitTextStep`/`SplitTextAnalyzeStep` types to
      `frontend/src/features/pipelines/types/pipelineStep.ts` (config shape mirrors the backend;
      include in the `PipelineStep`/`PipelineStepConfig`/`AnalyzeStepResult` unions).
- [x] 2.2 Create `frontend/src/features/pipelines/ui/SplitTextConfig.tsx`: field dropdown filtered
      to `analyzeSchema` entries with `type === "string-body"`, paragraph/heading mode toggle,
      heading-level numeric input (shown only in heading mode) — mirror `FilterConfig.tsx`'s
      `analyzeSchema`-driven field dropdown pattern.
- [x] 2.3 Add `"splittext"` to `OP_TYPES` in `stepNarrowing.ts` (icon, label), its
      `defaultConfigFor` seed (`{field: "", mode: "paragraph", headingLevel: 1, indexField:
      "segmentIndex"}`), and a `splitTextConfigOf` narrowing helper.
- [x] 2.4 Wire `SplitTextConfig` into `StepCard.tsx`'s per-op branch and `useStepCardState.ts`'s
      config-change handler, passing `analyzeSchema` (not just `analyzeColumns`).

## 3. Tests

- [x] 3.1 Create standalone `backend/src/test/scala/com/helio/domain/steps/SplitTextStepSpec.scala`
      (new precedent — no `CastStepSpec`/`GroupByStepSpec` exist to mirror; see design.md decision
      10) covering: paragraph split, heading split at a given level, passthrough fields, null-field
      row dropped, no-matching-heading row dropped.
- [x] 3.2 Backend unit tests for `PipelineAnalyzeService.inferSplitText` (valid string-body field,
      unknown field, non-string-body field) per the spec's three scenarios.
- [x] 3.3 Update `PipelineStepSpec.scala`'s exhaustiveness test: add `splittext` to `allSubtypes`,
      `PipelineStepKind.All` assertion set, the per-kind `kind` assertions, and the pattern-match
      coverage block (11 kinds total).
- [x] 3.4 Add a `"splittext" -> SplitTextConfig(...)` entry to
      `PipelineStepConfigCodecSpec.scala`'s `cases` round-trip list (exercises the new
      `extractConfig`/`encodeConfig` arms from task 1.5).
- [x] 3.5 Add a `SplitTextStepResponse(...)` entry to `PipelineStepProtocolSpec.scala`'s `subtypes`
      list (exercises the new `fromDomain`/write/read arms from task 1.4).
- [x] 3.6 Add a `case c: SplitTextConfig => SplitTextStep(...)` arm to
      `InProcessPipelineEngineSpec.scala`'s `makeStep` helper, plus one or two engine-level
      `splittext` scenarios alongside the other 10 kinds' tests in that file.
- [x] 3.7 Add a route-level `"POST with type 'splittext' is accepted"` test to
      `PipelineStepRoutesSpec.scala`, mirroring the existing `"POST with type 'aggregate' is
      accepted (regression: AllowedOps drift)"` test — required by the
      `pipeline-steps-persistence` spec delta's new scenario.
- [x] 3.8 Frontend test for `SplitTextConfig.tsx`: field dropdown only offers `string-body` fields,
      heading-level input visibility toggles with mode, config-change patches.
- [x] 3.9 Run `sbt test` and `npm test` for the full suite; run `npm run lint` (zero-warnings).
- [x] 3.10 (cycle 2, evaluation-1.md CR 3) Add a `splittext` scenario to
      `PipelineAnalyzeRoutesSpec.scala` seeding a pipeline with a `splittext` step against a
      `string-body`-bearing source schema, asserting `GET /api/pipelines/:id/analyze` returns `200`
      with the expected output schema (`indexField` appended) — this is the regression test that
      would have caught the cycle-1 500 bug.

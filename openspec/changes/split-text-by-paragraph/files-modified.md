## Backend — new files

- `backend/src/main/scala/com/helio/domain/steps/SplitTextStep.scala` — `SplitTextConfig` (tolerant
  decode), `SplitTextStep` (flatMap evaluate), `splitParagraphs`/`splitHeadings` pure split
  functions, and the `PipelineStep.Companion` registration object.
- `backend/src/main/resources/db/migration/V50__add_splittext_op.sql` — extends
  `pipeline_steps_op_check` to include `'splittext'` (drop/re-add pattern, mirrors V31).
- `backend/src/test/scala/com/helio/domain/steps/SplitTextStepSpec.scala` — new standalone
  per-step spec (first of its kind — see design.md decision 10): unit tests for
  `splitParagraphs`/`splitHeadings` and the row-level flatMap semantics (passthrough, null-drop,
  no-heading-match-drop, indexField collision).

## Backend — modified

- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registers `SplitTextStep` in
  `PipelineStep.Registry` and adds `PipelineStepKind.SplitText = "splittext"`.
- `backend/src/main/scala/com/helio/domain/package.scala` — adds `SplitTextStep`/`SplitTextConfig`
  type+val aliases so the `com.helio.domain._` wildcard import resolves them (not one of design.md's
  explicitly enumerated 6 sites, but load-bearing for every call site that imports the wildcard —
  repository, codec, protocol, tests).
- `backend/src/main/scala/com/helio/domain/steps/StepCodecUtil.scala` — adds a shared `intOr`
  helper (parallel to the existing `stringOr`) for `headingLevel`'s tolerant decode.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — adds
  `SplitTextStepResponse`, `splitTextConfigFormat`, `splitTextStepResponseFormat`, and both
  `fromDomain`/read-write-union match arms.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` — adds the
  `splittext` arms to `encodeConfig` and the private `extractConfig`.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — adds the
  `Success(cfg: SplitTextConfig) => SplitTextStep(...)` arm to `rowToDomain`.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — adds the `"splittext"`
  dispatch arm and `inferSplitText` (field-existence + string-body-type validation, `indexField`
  appended as `"integer"` on success, per design.md decision 5).
- `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala` — **(cycle 2 fix,
  evaluation-1.md CR 1)** adds `SplitTextAnalyzeStepResponse` (case class, `jsonFormat6`, both
  write/read match arms) to the separate `AnalyzeStepResponse` ADT — the actual 8th enumeration
  site design.md decision 8 missed in cycle 1.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — **(cycle 2 fix, evaluation-1.md
  CR 2)** adds the `case Success(cfg: SplitTextConfig) => SplitTextAnalyzeStepResponse(...)` arm to
  `toAnalyzeStepResponse`, fixing the `GET /api/pipelines/:id/analyze` 500 for any pipeline with a
  `splittext` step.

## Backend — tests updated (design.md decision 9's four hand-curated lists + route test)

- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — adds `splitText` to
  `allSubtypes`, the `PipelineStepKind.All` assertion, the `kind` assertions, and the
  pattern-match exhaustiveness block (11 kinds total).
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — adds a
  `splittext` decode-preserve case and a `SplitTextConfig` entry to the encode round-trip `cases`
  list.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` — adds a
  `SplitTextStepResponse` entry to the `subtypes` round-trip list.
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — adds the
  `SplitTextConfig => SplitTextStep` arm to `makeStep`, plus 3 engine-level `splittext` scenarios
  (paragraph mode, heading mode, null-drop).
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — adds 6 `splittext`
  inference scenarios (valid field, unknown field, non-string-body field, default indexField,
  indexField collision, malformed config).
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` — adds the route-level
  `"POST with type 'splittext' is accepted"` regression test (mirrors the existing `aggregate`
  regression test; required by the `pipeline-steps-persistence` spec delta).
- `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala` — **(cycle 2 fix,
  evaluation-1.md CR 3)** adds a `splittext` route-level scenario (seeds a `string-body` source
  field, asserts `GET /api/pipelines/:id/analyze` returns `200` with `segmentIndex` appended to the
  output schema) — the regression test that would have caught the cycle-1 500 bug.

## Backend — doc fix

- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — **(cycle 2, non-blocking
  suggestion)** bumps the doc comment's subtype count from "10"/"11th" to "11"/"12th" to reflect
  `splittext` now being registered.

## Frontend — new files

- `frontend/src/features/pipelines/ui/SplitTextConfig.tsx` — field dropdown (string-body only,
  via `analyzeSchema`), paragraph/heading mode toggle, heading-level numeric input (heading mode
  only).
- `frontend/src/features/pipelines/ui/SplitTextConfig.test.tsx` — field-dropdown filtering,
  heading-level visibility toggling, and config-change patch tests (spec.md's 4 frontend
  scenarios).

## Frontend — modified

- `frontend/src/features/pipelines/types/pipelineStep.ts` — adds `SplitTextConfig`,
  `SplitTextStep`, `SplitTextAnalyzeStep` to the respective discriminated unions.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — adds `"splittext"` to `OP_TYPES`
  (icon `faAlignLeft`), its `defaultConfigFor` seed, and the `splitTextConfigOf` narrowing helper.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — adds `splitTextConfig` state +
  `onSplitTextChange` handler, following the existing per-op state/persist pattern.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — wires `SplitTextConfig` into the per-op
  render branch, passing `analyzeSchema`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — adds
  `.pipeline-detail-page__splittext-config` to the existing flex-column config-container rule
  (reuses `filter-combinator`/`limit-config-row`/`compute-field` classes for the toggle/label/input
  recipes — no new visual patterns introduced).

## 1. Backend: step module

- [x] 1.1 Create `backend/src/main/scala/com/helio/domain/steps/AssertStep.scala`: `AssertRule(kind:
      String, field: Option[String], params: JsObject, severity: String)` with derived
      `jsonFormat4[AssertRule]`; `AssertConfig(rules: Vector[AssertRule])` with derived
      `jsonFormat1[AssertConfig]` for canonical encode; `AssertConfig.decode(raw: String)` per-field
      lenient (never throws — design.md Decision 2).
- [x] 1.2 Add `AssertStep` case class (`evaluate` = `Future.successful(rows)`) and its
      `PipelineStep.Companion` (`decodeConfig`/`encodeConfig`/`readFromWire`/`writeToWire`).
- [x] 1.3 Register `AssertStep.Kind` (`"assert"`) in `PipelineStep.Registry` and add
      `PipelineStepKind.Assert` in `backend/src/main/scala/com/helio/domain/PipelineStep.scala`.
- [x] 1.4 Add `AssertStep`/`AssertRule`/`AssertConfig` type + val aliases to
      `backend/src/main/scala/com/helio/domain/package.scala`.

## 2. Backend: wire protocol, codec, repository, patch-set

- [x] 2.1 `api/protocols/PipelineStepConfigCodec.scala`: add `AssertConfig`/`AssertStep` imports, an
      `encodeConfig` match arm, and an `extractConfig` match arm.
- [x] 2.2 `api/protocols/PipelineStepProtocol.scala`: add `AssertStepResponse`, its `jsonFormat`, the
      write-dispatch match arm, and the read-dispatch match arm (mirror `LookupStepResponse`).
- [x] 2.3 `infrastructure/PipelineStepRepository.scala`: add the `case Success(cfg: AssertConfig) =>
      AssertStep(...)` row-decode arm.
- [x] 2.4 `services/PatchSetPreviewProjectionSteps.scala`: add the position-copy match arm and the
      config-update match arm for `AssertStep`/`AssertConfig`.

## 3. Backend: migration + schema inference

- [x] 3.1 Re-check `backend/src/main/resources/db/migration/` for the current highest `VNN` immediately
      before writing the file (design.md Decision 7 — do not trust a number from planning).
- [x] 3.2 Add `V<NN>__add_assert_op.sql`: drop/re-add `pipeline_steps_op_check` including `'assert'`,
      following `V72__add_lookup_op.sql`'s pattern exactly (full existing op list + `'assert'`).
- [x] 3.3 `domain/PipelineAnalyzeService.scala`: add a dedicated `case "assert" => inferAssert(...)`
      dispatch arm (not the blanket identity group) implementing design.md Decisions 4-6: identity
      output schema always; `validationError` aggregating every rule's kind/severity/field problems.
- [x] 3.4 `api/protocols/PipelineAnalyzeProtocol.scala`: define `AssertAnalyzeStepResponse` (extends the
      sealed `AnalyzeStepResponse`, `type` = `PipelineStepKind.Assert`), its `jsonFormat6` instance, and
      its arm in both the `analyzeStepResponseFormat.write` and `.read` dispatch (mirror
      `LookupAnalyzeStepResponse` exactly — this is the type's declaration site, distinct from 3.5).
- [x] 3.5 `services/PipelineService.scala`: wire the `case Success(cfg: AssertConfig) =>
      AssertAnalyzeStepResponse(...)` construction arm in the analyze response assembly (mirror the
      `LookupConfig`/`LookupAnalyzeStepResponse` construction arm) — no ACL pre-flight needed (assert
      has no second-source reference).

## 4. Frontend: types

- [x] 4.1 `features/pipelines/types/pipelineStep.ts`: add `AssertRule`, `AssertConfig`, `AssertStep`
      (add to the `PipelineStep`/`PipelineStepConfig` unions), `AssertAnalyzeStep` (add to
      `AnalyzeStepResult`).

## 5. Frontend: editor + wiring

- [x] 5.1 Create `frontend/src/features/pipelines/ui/AssertConfig.tsx` following `FilterConfig.tsx`'s
      structure: rule rows (kind select, field select shown only for field-requiring kinds per
      design.md Decision 4, kind-specific params inputs, severity select), add/remove rule controls.
- [x] 5.2 `features/pipelines/state/stepNarrowing.ts`: add an `assert` entry to `OP_TYPES`, an `"assert"`
      case to `defaultConfigFor` (empty `rules`), and an `assertConfigOf` narrowing helper.
- [x] 5.3 `features/pipelines/hooks/useStepCardState.ts`: add `assertConfig` state + `onAssertChange`
      handler, wired through `persist`.
- [x] 5.4 `features/pipelines/ui/StepCard.tsx`: import `AssertConfig` and add the
      `step.opType.id === "assert"` render branch.
- [x] 5.5 `schemas/pipeline-proposal.schema.json`: append `assert` to the `type` field's descriptive
      (non-enforced) op-list doc string, matching every prior op ticket's update to that same string.

## 6. Tests

- [x] 6.1 Backend: extend `PipelineStepSpec` with an `AssertStep` instance in `allSubtypes`/kind
      checks (parity + exhaustiveness tests must stay green).
- [x] 6.2 Backend: unit tests for `AssertConfig.decode` tolerance (missing `rules`, malformed rule
      entries never throw) — colocate with the precedent per-step specs
      (`backend/src/test/scala/com/helio/domain/steps/`).
- [x] 6.3 Backend: `PipelineAnalyzeService` tests for the `assert` case — identity schema, unknown
      field, invalid kind, invalid severity, `rowCountMin`/`rowCountMax` field-exempt.
- [x] 6.4 Backend: `sbt test` passes (full suite, including `PipelineStepConfigCodecSpec`,
      `PipelineStepProtocolSpec`, `InProcessPipelineEngineSpec` regression).
- [x] 6.5 Frontend: `AssertConfig.test.tsx` covering add rule, remove rule, per-kind field
      show/hide, and onChange payloads (mirror `FilterConfig.test.tsx`'s structure).
- [x] 6.6 Frontend: `npm test` passes.

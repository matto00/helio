## 1. ### Backend — domain step

- [x] 1.1 Confirm the next free Flyway VNN (`ls backend/src/main/resources/db/migration/ | sort`) —
      do this immediately before 4.1, not earlier.
- [x] 1.2 Create `backend/src/main/scala/com/helio/domain/steps/UnpivotStep.scala`:
      `UnpivotConfig(idVars: Vector[String], valueVars: Vector[String], varName: String, valueName:
      String)`, tolerant `decode` (mirror `PivotConfig.decode`'s `JsArray` extraction for
      `idVars`/`valueVars`, `StepCodecUtil.stringOr` defaulting `varName`→`"variable"`,
      `valueName`→`"value"` per design.md decision 2), `UnpivotStep.evaluate` (nested per-row ×
      per-valueVar emission per design.md decisions 3-5), `companion` (JSON codec mirroring
      `PivotStep`/`CastStep`'s `Companion` shape).
- [x] 1.3 Register `UnpivotStep.Kind -> UnpivotStep.companion` in `PipelineStep.Registry` and add
      `PipelineStepKind.Unpivot` (`PipelineStep.scala`).
- [x] 1.4 Add `type UnpivotStep`/`val UnpivotStep` and `type UnpivotConfig`/`val UnpivotConfig`
      aliases to `domain/package.scala`.

## 2. ### Backend — wire protocol + persistence

- [x] 2.1 `PipelineStepProtocol.scala`: `UnpivotStepResponse` case class, implicit `UnpivotConfig`
      format, `jsonFormat6` formatter, `write`/`read` union arms, `PipelineStepResponse.fromDomain`
      arm.
- [x] 2.2 `PipelineStepConfigCodec.scala`: `encodeConfig`/`extractConfig` arms for `UnpivotConfig`.
- [x] 2.3 `PipelineStepRepository.rowToDomain` (`infrastructure/PipelineStepRepository.scala`): add
      `case Success(cfg: UnpivotConfig) => UnpivotStep(...)` arm.

## 3. ### Backend — analyze

- [x] 3.1 `PipelineAnalyzeService.scala`: add `"unpivot" -> inferUnpivot(...)` dispatch arm and
      `inferUnpivot` per design.md decisions 6-8 (idVars + varName(string) + valueName(common-or-
      string) output schema, existence-validation on `idVars`/`valueVars`, identity fallback +
      `validationError` only on genuine misconfiguration).
- [x] 3.2 `PipelineAnalyzeProtocol.scala`: `UnpivotAnalyzeStepResponse` (standard 6-field shape),
      `jsonFormat6` formatter, `write`/`read` union arms.
- [x] 3.3 `PipelineService.toAnalyzeStepResponse` (`services/PipelineService.scala`): add
      `case Success(cfg: UnpivotConfig) => UnpivotAnalyzeStepResponse(...)` arm.

## 4. ### Backend — migration

- [x] 4.1 Reconfirm the next free VNN (may have shifted since 1.1 if a concurrent lane merged) and
      create `V<NN>__add_unpivot_op.sql`: drop/re-add `pipeline_steps_op_check` adding `'unpivot'`,
      following `V50__add_splittext_op.sql`'s pattern exactly.

## 5. ### Frontend

- [x] 5.1 `frontend/src/features/pipelines/types/pipelineStep.ts`: `UnpivotConfig` wire interface,
      `UnpivotStep`/`UnpivotAnalyzeStep` interfaces, add to the `PipelineStep`/`PipelineStepConfig`/
      `AnalyzeStep` unions (mirror `PivotConfig`/`PivotStep`/`PivotAnalyzeStep`'s additions exactly
      — 4 touch points per op).
- [x] 5.2 `frontend/src/features/pipelines/state/stepNarrowing.ts`: `OP_TYPES` entry (label + a
      FontAwesome icon not already in use), `defaultConfigFor` case (`{idVars: [], valueVars: [],
      varName: "variable", valueName: "value"}`), `unpivotConfigOf` narrowing helper mirroring
      `pivotConfigOf`.
- [x] 5.3 Create `frontend/src/features/pipelines/ui/UnpivotConfig.tsx`: `idVars`/`valueVars`
      multi-selects (mirroring `PivotConfig`'s `index` multi-select rows), `varName`/`valueName`
      text inputs pre-filled with their defaults.
- [x] 5.4 Wire the render arm into `StepCard.tsx` and state into `hooks/useStepCardState.ts`
      (mirror the `pivot` wiring in both files).

## 6. ### MCP

- [x] 6.1 `helio-mcp/src/tools/write.ts`: add `unpivot` to the `add_pipeline_step` description's
      type list and document its `config` shape (`idVars`/`valueVars`/`varName`/`valueName`) —
      `type` is free-text `z.string()`, no enum/schema change needed.

## 7. ### Tests

- [x] 7.1 `InProcessPipelineEngineSpec.scala`: round-trip execution test(s) covering basic unpivot,
      row-count multiplication, default `varName`/`valueName`, missing `idVars`/`valueVars` field
      handling, and the `valueName`-collides-with-`idVars` collision case (spec.md scenarios).
- [x] 7.2 `PipelineAnalyzeServiceSpec.scala`: analyze-schema tests covering idVars + varName(string)
      + valueName(common type) output schema with no validation error, mixed-type
      valueVars→string fallback, and validation errors for unknown `idVars`/`valueVars` fields.
- [x] 7.3 `PipelineStepConfigCodecSpec.scala`: codec round-trip test for `UnpivotConfig`.
- [x] 7.4 `PipelineStepSpec.scala`: update kind-parity test to include `unpivot`.
- [x] 7.5 `PipelineStepProtocolSpec.scala`: wire format round-trip test for `UnpivotStepResponse`
      (mirror `pivot`'s addition, if the existing suite covers other ops' wire formats here).
- [x] 7.6 New `frontend/src/features/pipelines/ui/UnpivotConfig.test.tsx` (CONTRIBUTING-bound
      co-located test) covering field selection, varName/valueName inputs, and `onChange`
      round-trip.

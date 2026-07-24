## 1. ### Backend — domain step

- [x] 1.1 Confirm the next free Flyway VNN (`ls backend/src/main/resources/db/migration/ | sort`) —
      do this immediately before 1.6, not earlier.
- [x] 1.2 Create `backend/src/main/scala/com/helio/domain/steps/PivotStep.scala`: `PivotConfig(index:
      Vector[String], column: String, values: String, agg: String)`, tolerant `decode` (mirror
      `AggregateConfig.decode`'s `Try`-wrapped field extraction), `PivotStep.evaluate` (grouping +
      `<values>_<v>` column emission per design.md decisions 1-4), `companion` (JSON codec mirroring
      `CastStep`/`AggregateStep`'s `Companion` shape).
- [x] 1.3 Register `PivotStep.Kind -> PivotStep.companion` in `PipelineStep.Registry` and add
      `PipelineStepKind.Pivot` (`PipelineStep.scala`).
- [x] 1.4 Add `type PivotStep`/`val PivotStep` and `type PivotConfig`/`val PivotConfig` aliases to
      `domain/package.scala`.

## 2. ### Backend — wire protocol + persistence

- [x] 2.1 `PipelineStepProtocol.scala`: `PivotStepResponse` case class, implicit `PivotConfig`
      format, `jsonFormat6` formatter, `write`/`read` union arms, `PipelineStepResponse.fromDomain`
      arm.
- [x] 2.2 `PipelineStepConfigCodec.scala`: `encodeConfig`/`extractConfig` arms for `PivotConfig`.
- [x] 2.3 `PipelineStepRepository.rowToDomain` (`infrastructure/PipelineStepRepository.scala`): add
      `case Success(cfg: PivotConfig) => PivotStep(...)` arm.

## 3. ### Backend — analyze

- [x] 3.1 `PipelineAnalyzeService.scala`: add `"pivot" -> inferPivot(...)` dispatch arm and
      `inferPivot` per design.md decision 5 (index-only output schema, existence-validation on
      `index`/`column`/`values`, identity fallback + `validationError` only on genuine
      misconfiguration).
- [x] 3.2 `PipelineAnalyzeProtocol.scala`: `PivotAnalyzeStepResponse` (standard 6-field shape),
      `jsonFormat6` formatter, `write`/`read` union arms.
- [x] 3.3 `PipelineService.toAnalyzeStepResponse` (`services/PipelineService.scala`): add
      `case Success(cfg: PivotConfig) => PivotAnalyzeStepResponse(...)` arm.

## 4. ### Backend — migration

- [x] 4.1 Reconfirm the next free VNN (may have shifted since 1.1 if a concurrent lane merged) and
      create `V<NN>__add_pivot_op.sql`: drop/re-add `pipeline_steps_op_check` adding `'pivot'`,
      following `V50__add_splittext_op.sql`'s pattern exactly. (Confirmed V65 free; origin/main max
      still V64 at time of writing.)

## 5. ### Frontend

- [x] 5.1 `frontend/src/features/pipelines/types/pipelineStep.ts`: `PivotConfig` wire interface,
      `PivotStep`/`PivotAnalyzeStep` interfaces, add to the `PipelineStep`/`PipelineStepConfig`/
      `AnalyzeStep` unions (mirror `DateBucketConfig`/`DateBucketStep`/`DateBucketAnalyzeStep`'s
      additions exactly — 4 touch points per op).
- [x] 5.2 `frontend/src/features/pipelines/state/stepNarrowing.ts`: `OP_TYPES` entry (label + a
      FontAwesome icon not already in use, e.g. `faTableCells`), `defaultConfigFor` case (`{index:
      [], column: "", values: "", agg: "sum"}`), `pivotConfigOf` narrowing helper mirroring
      `aggregateConfigOf`/`dateBucketConfigOf`.
- [x] 5.3 Create `frontend/src/features/pipelines/ui/PivotConfig.tsx`: index field multi-select
      (rows with add/remove, mirroring `AggregateConfig`'s `groupBy` rows), `column`/`values`
      single-field dropdowns, `agg` dropdown seeded with a local `PIVOT_AGG_FNS = ["sum", "count",
      "avg", "min", "max", "first"]` constant (design.md Planner Notes — do not reuse
      `AggregateConfig.AGG_FNS`, which lacks `first`).
- [x] 5.4 Wire the render arm into `StepCard.tsx` and state into `hooks/useStepCardState.ts`
      (mirror the `datebucket` wiring in both files).

## 6. ### MCP

- [x] 6.1 `helio-mcp/src/tools/write.ts`: add `pivot` to the `add_pipeline_step` description's type
      list and document its `config` shape (`index`/`column`/`values`/`agg`) — `type` is free-text
      `z.string()`, no enum/schema change needed.

## 7. ### Tests

- [x] 7.1 `InProcessPipelineEngineSpec.scala`: round-trip execution test(s) covering basic pivot,
      each `agg` function, unsupported-agg failure, and null-column-value handling (spec.md
      scenarios).
- [x] 7.2 `PipelineAnalyzeServiceSpec.scala`: analyze-schema tests covering index-only output schema
      with no validation error, and validation errors for unknown `index`/`column`/`values` fields.
- [x] 7.3 `PipelineStepConfigCodecSpec.scala`: codec round-trip test for `PivotConfig`.
- [x] 7.4 `PipelineStepSpec.scala`: update kind-parity test to include `pivot`.
- [x] 7.5 `PipelineStepProtocolSpec.scala`: wire format round-trip test for `PivotStepResponse` (if
      the existing suite covers other ops' wire formats here — mirror `datebucket`'s addition).
- [x] 7.6 New `frontend/src/features/pipelines/ui/PivotConfig.test.tsx` (CONTRIBUTING-bound
      co-located test) covering field selection, agg dropdown, and `onChange` round-trip.

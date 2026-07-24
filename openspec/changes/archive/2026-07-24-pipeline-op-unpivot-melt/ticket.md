# HEL-380: Pipeline op: unpivot / melt (wide → long)

## Context

The inverse of pivot: collapse many value columns into two columns (variable, value), repeating the id columns per row. Needed to normalize wide sources before aggregation. Existing ops live in `backend/src/main/scala/com/helio/domain/steps/`; study `SelectStep.scala` and `CastStep.scala` as codec templates.

## Scope

Backend:

* New `backend/src/main/scala/com/helio/domain/steps/UnpivotStep.scala` — `UnpivotConfig(idVars: Vector[String], valueVars: Vector[String], varName: String, valueName: String)` + tolerant `decode` + `UnpivotStep.evaluate` + `companion`. Semantics: for each input row, emit one output row per `valueVars` column: the `idVars` unchanged, plus `varName` = the column name (string) and `valueName` = that cell's value. Defaults: `varName`="variable", `valueName`="value". No inline fully-qualified names.
* `PipelineStep.scala` — register + `PipelineStepKind.Unpivot`.
* `PipelineStepProtocol.scala` — `UnpivotStepResponse` + format + `jsonFormat6` + union arms + `fromDomain`.
* `PipelineStepConfigCodec.scala` — `encodeConfig` + `extractConfig` arms.
* `PipelineAnalyzeService.scala` — dispatch case + `inferUnpivot`: output = `idVars` (types carried through) + `varName` (string) + `valueName` (common type of `valueVars` if uniform, else `string`).
* `PipelineAnalyzeProtocol.scala` — `UnpivotAnalyzeStepResponse` + union arms.
* Flyway migration — extend `pipeline_steps_op_check` to add `'unpivot'` (drop/re-add per `V50__add_splittext_op.sql`). Next available VNN — RE-CONFIRM the current max migration number immediately before writing the migration, and again immediately before the delivery push (main was at V66 as of HEL-376/PR #281; three v1.6 lanes may contend for the next number).

Frontend:

* `types/pipelineStep.ts` — `UnpivotConfig` wire type (4 additions per op, per existing pattern).
* `state/stepNarrowing.ts` — `OP_TYPES` entry (label + icon), `defaultConfigFor` case, `unpivotConfigOf` helper.
* New `ui/UnpivotConfig.tsx` editor (idVars + valueVars multi-selects, varName/valueName inputs) + co-located `UnpivotConfig.test.tsx`; wire into `StepCard.tsx` + `useStepCardState.ts`.

MCP:

* `helio-mcp/src/tools/write.ts` — add `unpivot` to `add_pipeline_step`. NOTE: `type` param is free-text `z.string()`, NOT an enum — document the new op in the tool description string.

## Other exhaustive-match consumers to update (find by grepping an existing op)

* `domain/package.scala`
* `PipelineStepRepository.rowToDomain`
* `PipelineService.toAnalyzeStepResponse`
* `stepNarrowing.ts`

## Design guidance (unpivot is statically-knowable, unlike pivot)

Unlike pivot, unpivot's output schema is exactly determinable from config without sampling data:

* Output schema = `idVars` (types carried through from input) + `varName` column (type: string) + `valueName` column (type: common/widened type of `valueVars` if uniform, else `string` fallback).
* Row-count multiplication: one output row per (input row × valueVar), i.e. `N input rows * len(valueVars) = N output rows`.
* Null handling: pin explicitly in design.md.
* Precedents to study: HEL-375 pivot (just merged, sibling reshaping op) and HEL-378 datebucket.

## Acceptance criteria

- [ ] `unpivot` executes: N value columns → N rows per input row, idVars repeated, varName/valueName populated.
- [ ] `analyze_pipeline` yields idVars + varName(string) + valueName(common or string) — apply/infer parity.
- [ ] `pipeline_steps` op CHECK accepts `'unpivot'`; migration applies cleanly.
- [ ] Frontend StepCard renders a working editor; config PATCHes round-trip.
- [ ] MCP `add_pipeline_step` lists `unpivot` + config shape.
- [ ] Tests: round-trip execution in `InProcessPipelineEngineSpec.scala`; analyze-schema test; codec round-trip; `PipelineStepSpec.scala` kind-parity updated.
- [ ] Backward compatible: additive; existing pipelines/rows unaffected.

## Out of scope

* DAG/branching — chains linearly.

## Dependencies

* None.

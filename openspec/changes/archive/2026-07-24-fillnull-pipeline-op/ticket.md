# HEL-388: Pipeline op: fill-null / impute (constant / forward-fill / column stat)

Priority: Medium
Project: Helio v1.6 — Agentic Workflows & Pipelines
Parent: HEL-336 (Pipeline Op Expansion epic)
URL: https://linear.app/helioapp/issue/HEL-388/pipeline-op-fill-null-impute-constant-forward-fill-column-stat

## Context

Rows with missing values break downstream aggregation and charts. Users need to fill nulls with a constant, forward-fill from the previous row, or impute a column statistic (mean/median/mode). No such op exists. Existing ops live in `backend/src/main/scala/com/helio/domain/steps/`; study `CastStep.scala` (per-field transform, schema-preserving) as the template.

## Scope

Backend:

* New `backend/src/main/scala/com/helio/domain/steps/FillNullStep.scala` — `FillNullConfig(columns: Vector[String], strategy: String, value: Option[String])` + tolerant `decode` + `FillNullStep.evaluate` + `companion`. Strategies: `constant` (uses `value`), `forwardFill` (carry previous non-null in row order), `mean`/`median`/`mode` (computed per column over the batch, numeric for mean/median). Only null cells are replaced; non-null cells pass through. Unsupported strategy fails at execute time with a descriptive error. No inline fully-qualified names.
* `PipelineStep.scala` — register + `PipelineStepKind.FillNull`.
* `PipelineStepProtocol.scala` — `FillNullStepResponse` + format + `jsonFormat6` + union arms + `fromDomain`.
* `PipelineStepConfigCodec.scala` — `encodeConfig` + `extractConfig` arms.
* `PipelineAnalyzeService.scala` — dispatch case: output schema == input schema unchanged (types unchanged; add to the passthrough group).
* `PipelineAnalyzeProtocol.scala` — `FillNullAnalyzeStepResponse` + union arms.
* Flyway migration — extend `pipeline_steps_op_check` to add `'fillnull'` (drop/re-add per `V50__add_splittext_op.sql`). Next available VNN, assigned at scheduling time (main at V59 per ticket text; re-verify — main is now at V68 after HEL-382/PR #283, so next free is likely V69 — RE-CONFIRM immediately before writing the migration AND again right before the delivery push via `ls backend/src/main/resources/db/migration/ | sort`, since three v1.6 lanes may contend for the same VNN).

Frontend:

* `types/pipelineStep.ts` — `FillNullConfig` wire type.
* `state/stepNarrowing.ts` — `OP_TYPES` entry (label + icon), `defaultConfigFor` case, `fillNullConfigOf` helper.
* New `ui/FillNullConfig.tsx` editor (columns multi-select, strategy dropdown, constant value input shown only for `constant`); wire into `StepCard.tsx` + `useStepCardState.ts`.

MCP:

* `helio-mcp/src/tools/write.ts` — add `fillnull` to `add_pipeline_step` + config shape. Note: `add_pipeline_step`'s `type` param is free-text `z.string()`, NOT an enum — document the new op in the tool description string.

## Acceptance criteria

- [ ] Each strategy fills only null cells in the named columns; constant/forwardFill/mean/median/mode all behave correctly; unsupported strategy fails with a descriptive error.
- [ ] `analyze_pipeline` returns the input schema unchanged (identity passthrough).
- [ ] `pipeline_steps` op CHECK accepts `'fillnull'`; migration applies cleanly.
- [ ] Frontend StepCard renders a working editor; config PATCHes round-trip.
- [ ] MCP `add_pipeline_step` lists `fillnull` + config shape.
- [ ] Tests: round-trip execution (each strategy) in `InProcessPipelineEngineSpec.scala`; analyze passthrough test; codec round-trip; `PipelineStepSpec.scala` kind-parity updated.
- [ ] Backward compatible: additive; existing pipelines/rows unaffected.

## Out of scope

* Cross-partition forward-fill grouping (whole-batch order only).
* DAG/branching — chains linearly.

## Dependencies

* None.

## Design notes (from orchestrator brief)

* fill-null is a per-field transform that is SCHEMA-PRESERVING (output schema == input schema, like CastStep — so `inferFillNull` is identity on the input schema; no column added/removed).
* Pin in design.md: the fill strategies (constant / forward-fill / mean / median / mode) and which apply to which column types (mean/median numeric-only; mode/constant/ffill any type); forward-fill semantics (carry the last non-null value down in original row order — a leading-null region stays null); how a column-stat is computed (single pass over non-null values); null definition (JsNull and/or missing key); and per-field config (which columns get which strategy).
* CastStep is the schema-preserving template; the window/running-total op (HEL-376, WindowStep) is a good precedent for order-dependent forward-fill semantics and single-pass column computation.
* Exhaustive-match consumers to find via grep of an existing op: `domain/package.scala`, `PipelineStepRepository.rowToDomain`, `PipelineService.toAnalyzeStepResponse`, `stepNarrowing.ts`.
* `pipelineStep.ts` needs 4 additions per op (find pattern from an existing op).

## Merge hazard

'fillnull' adds a value to the `pipeline_steps_op_check` constraint (V50 pattern). Flyway V-numbers are NOT hardcoded — re-confirm the current max via `ls backend/src/main/resources/db/migration/ | sort` immediately before writing the migration AND again before the delivery push (make BOTH re-checks explicit tasks in tasks.md — the design gate REFUTES if the second one is missing, as happened on HEL-382).

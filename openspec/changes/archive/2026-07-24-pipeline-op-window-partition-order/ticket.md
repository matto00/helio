# HEL-376: Pipeline op: window (partition + order → rank / row_number / running total / lag / lead)

## Context

There is no way to compute per-partition ordered analytics (rank, row_number, running total, lag/lead). These are needed for "rank within category", "cumulative total over time", and top-N-per-group patterns. Existing ops live in `backend/src/main/scala/com/helio/domain/steps/`; study `SortStep.scala` (ordering) and `AggregateStep.scala` (grouping) as references.

## Scope

Backend:

* New `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala` — `WindowConfig(partitionBy: Vector[String], orderBy: Vector[SortKey], function: String, field: Option[String], outputColumn: String, offset: Option[Int])` + tolerant `decode` + `WindowStep.evaluate` + `companion`. Functions: `row_number`, `rank`, `dense_rank` (integer, ignore `field`); `running_sum` (number, over `field`); `lag`/`lead` (same type as `field`, using `offset`, default 1). Within each partition, apply `orderBy`, then compute the function; append `outputColumn`. Reuse the existing `SortKey` shape for `orderBy`. No inline fully-qualified names.
* `PipelineStep.scala` — register in `PipelineStep.Registry` + `PipelineStepKind.Window`.
* `PipelineStepProtocol.scala` — `WindowStepResponse` + implicit config format + `jsonFormat6` + `write`/`read` union arms + `fromDomain` arm.
* `PipelineStepConfigCodec.scala` — `encodeConfig` + `extractConfig` arms.
* `PipelineAnalyzeService.scala` — dispatch case + `inferWindow`: output = input schema + `outputColumn` (type per function: integer for rank/row_number/dense_rank; number for running_sum; same-as-`field` for lag/lead). Replace any existing field of the same name (same collision rule `compute` uses).
* `PipelineAnalyzeProtocol.scala` — `WindowAnalyzeStepResponse` + union arms.
* Flyway migration — extend `pipeline_steps_op_check` to add `'window'` (drop/re-add per `V50__add_splittext_op.sql`). Next available VNN, assigned at scheduling time (main at V59; three v1.6 lanes may contend).

  **CONFIRMED at orchestration time (2026-07-24): local main was stale and has been fast-forwarded to origin/main (1bb95832, HEL-375 pivot op, PR #280). Latest migration on main is `V65__add_pivot_op.sql`. This change must use `V66__add_window_op.sql`. Re-confirm the max migration version again immediately before the delivery push, since other v1.6 op lanes may land in parallel.**

Frontend:

* `types/pipelineStep.ts` — `WindowConfig` wire type.
* `state/stepNarrowing.ts` — `OP_TYPES` entry (label + icon), `defaultConfigFor` case, `windowConfigOf` helper.
* New `ui/WindowConfig.tsx` editor (partitionBy multi-select, orderBy keys, function dropdown, field, outputColumn, offset); wire into `StepCard.tsx` + `useStepCardState.ts`.

MCP:

* `helio-mcp/src/tools/write.ts` — add `window` to `add_pipeline_step` description + config shape.

## Acceptance criteria

- [ ] `window` executes each function correctly per partition and order; unsupported `function` fails at execute time with a descriptive error.
- [ ] `analyze_pipeline` appends `outputColumn` with the correct type per function (apply/infer parity).
- [ ] `pipeline_steps` op CHECK accepts `'window'`; migration applies cleanly.
- [ ] Frontend StepCard renders a working window editor; config PATCHes round-trip.
- [ ] MCP `add_pipeline_step` lists `window` + config shape.
- [ ] Tests: round-trip execution (each function) in `InProcessPipelineEngineSpec.scala`; analyze-schema test; codec round-trip; `PipelineStepSpec.scala` kind-parity updated.
- [ ] Backward compatible: additive; existing pipelines/rows unaffected.

## Out of scope

* SQL-window pushdown to the source DB — computed in-engine over loaded rows.
* DAG/branching — chains linearly.

## Dependencies

* None.

## Op-wiring checklist (from CLAUDE.md / prior op tickets)

Follow the op-wiring checklist established by prior pipeline-op tickets (HEL-378 datebucket, HEL-375 pivot):
- apply/infer parity
- `allowedOps` surface
- Flyway migration adding the op to the `pipeline_steps_op_check` constraint
- frontend StepCard config editor (`WindowConfig.tsx` + co-located `.test.tsx` — CONTRIBUTING binds the test)
- `pipelineStep.ts` needs 4 additions per op
- exhaustive-match consumers: `domain/package.scala`, `PipelineStepRepository.rowToDomain`, `PipelineService.toAnalyzeStepResponse`, `stepNarrowing.ts` — find them by grepping an existing op (e.g. `datebucket` or `pivot`)
- MCP: `helio-mcp/src/tools/write.ts` `add_pipeline_step` `type` is free-text `z.string()`, NOT an enum — document the new op in the tool description string

Reference templates cited by the ticket: `SortStep.scala` (ordering), `AggregateStep.scala` (grouping). Also worth reviewing the most recently shipped ops for the current wiring pattern: `DateBucketStep.scala` (HEL-378) and `PivotStep.scala` (HEL-375).

## Design note for the design gate

`window` is a partition + order op that ADDS a derived column per row (rank/row_number/running-total/lag/lead) while preserving row count. Unlike pivot it's schema-additive (predictable output column), so the analyze/infer path is simpler than pivot's — the derived column name/type is knowable statically. The design must be unambiguous about:
- partition-by field(s) + order-by field(s) + which function + the output column name
- null handling for lag/lead at partition edges
- running-total numeric-coercion parity with the aggregate op

Pin these so the design gate has a concrete mechanism to verify each claim.

## Merge hazard

`window` adds a value to the `pipeline_steps_op_check` constraint (V50 pattern). Flyway V-numbers are NOT hardcoded — confirm the current max version immediately before writing the migration, and again immediately before the delivery push (three v1.6 op lanes — datebucket, pivot, window — may contend for the same V-number).

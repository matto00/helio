# HEL-375: Pipeline op: pivot (long → wide)

Priority: High
Project: Helio v1.6 — Agentic Workflows & Pipelines
Parent: HEL-336 (Epic: Pipeline Op Expansion)
URL: https://linear.app/helioapp/issue/HEL-375/pipeline-op-pivot-long-wide

## Context

The pipeline vocabulary can reshape rows (filter/aggregate/sort) but cannot pivot a long table to wide (one row per index key, one column per distinct value of a pivot column). This blocks matrix/crosstab panels and the pivot/matrix smart shape (HEL-337). Existing ops live in `backend/src/main/scala/com/helio/domain/steps/`; study `AggregateStep.scala` (grouping) and `CastStep.scala` (codec template).

The hard part is analyze: the pivoted output columns depend on the *data* (distinct values of the pivot column), so they cannot be statically enumerated from the input schema alone. Analyze must handle this explicitly rather than guess.

## Scope

Backend:

* New `backend/src/main/scala/com/helio/domain/steps/PivotStep.scala` — `PivotConfig(index: Vector[String], column: String, values: String, agg: String)` + tolerant `decode` + `PivotStep.evaluate` (execution) + `companion` (JSON codec). Semantics: group by `index`; for each distinct value `v` of `column`, emit an output column named `v` (or `<values>_<v>` — decide in impl, document it) whose cell is `agg` (`sum`/`count`/`avg`/`min`/`max`/`first`) over `values` for rows in that group+value. No inline fully-qualified names (imports rule, CONTRIBUTING.md).
* `PipelineStep.scala` — register in `PipelineStep.Registry` + add `PipelineStepKind.Pivot`.
* `PipelineStepProtocol.scala` — `PivotStepResponse` + implicit config format + `jsonFormat6` formatter + `write`/`read` union arms + `PipelineStepResponse.fromDomain` arm.
* `PipelineStepConfigCodec.scala` — `encodeConfig` + `extractConfig` arms.
* `PipelineAnalyzeService.scala` — add the `inferOutputSchema` dispatch case + `inferPivot`. Because pivoted columns are data-dependent, output schema = the `index` fields (types carried through) plus a documented representation for the dynamic value columns (e.g. no static value columns + a non-error note, OR a single sentinel). Do NOT emit a spurious `validationError`. Document the choice in the ticket's PR.
* `PipelineAnalyzeProtocol.scala` — `PivotAnalyzeStepResponse` + union arms.
* Flyway migration — extend the `pipeline_steps_op_check` CHECK constraint to add `'pivot'` (drop/re-add per `V50__add_splittext_op.sql`). Use the next available VNN, assigned at scheduling time (main is at V64 as of HEL-375 kickoff; re-confirm the current max immediately before writing the migration AND again before the delivery push — concurrent lanes may contend).

Frontend:

* `frontend/src/features/pipelines/types/pipelineStep.ts` — `PivotConfig` wire type in the union.
* `frontend/src/features/pipelines/state/stepNarrowing.ts` — `OP_TYPES` entry (label + FontAwesome icon), `defaultConfigFor` case, `pivotConfigOf` narrowing helper.
* New `frontend/src/features/pipelines/ui/PivotConfig.tsx` editor; wire the render arm into `StepCard.tsx` and state into `hooks/useStepCardState.ts`.

MCP:

* `helio-mcp/src/tools/write.ts` — add `pivot` to the `add_pipeline_step` description's type list and document its `config` shape. NOTE: `type` is free-text `z.string()`, NOT an enum — document via the description string only.

## Acceptance criteria

- [ ] `pivot` executes: long rows → wide, one row per `index` tuple, one column per distinct `column` value, cell = `agg(values)`. Unsupported `agg` fails at execute time with a descriptive error (parity with `AggregateStep`).
- [ ] `analyze_pipeline` returns the `index` fields as output schema and represents the dynamic value columns per the documented rule, with NO false `validationError`.
- [ ] Apply/infer parity holds for the statically-known (index) columns.
- [ ] The `pipeline_steps` op CHECK constraint accepts `'pivot'`; Flyway migration applies cleanly on a fresh and an existing DB.
- [ ] Frontend StepCard renders a working pivot editor (index / column / values / agg); config PATCHes round-trip.
- [ ] MCP `add_pipeline_step` description lists `pivot` + its config shape.
- [ ] Tests: round-trip execution test in `InProcessPipelineEngineSpec.scala`; analyze-schema test; codec round-trip in `PipelineStepConfigCodecSpec.scala`; `PipelineStepSpec.scala` kind-parity updated.
- [ ] Backward compatible: additive op; existing pipelines, persisted steps, and rows are unaffected; unknown-kind tolerance preserved.

## Out of scope

* The pivot/matrix smart shape (HEL-337) — this ticket is the raw op only.
* The DAG/branching authoring model — pivot still chains linearly.

## Dependencies

* None. Unblocks the pivot/matrix smart shape in HEL-337.

## Additional orchestrator notes (from kickoff)

* Follow the op-wiring checklist: new steps/PivotStep.scala, apply + infer(analyze) parity, `allowedOps` surface, Flyway migration adding 'pivot' to the pipeline_steps_op_check constraint, frontend StepCard config editor (PivotConfig.tsx + co-located .test.tsx — CONTRIBUTING binds the test), pipelineStep.ts needs 4 additions per op, plus the exhaustive-match consumers (domain/package.scala, PipelineStepRepository.rowToDomain, PipelineService.toAnalyzeStepResponse, stepNarrowing.ts) — find them by grepping an existing op (e.g. the just-merged HEL-378 datebucket op, `backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala`, is a fresh precedent for the full wiring checklist).
* Pivot is a schema-RESHAPING op (output columns are DATA-DEPENDENT — one per distinct pivot value), which is more complex than datebucket's per-field transform. The design must address how inferSchema/analyze handles dynamic output columns without guessing and without a spurious validationError. This is a likely design-gate focus.
* MERGE HAZARD: 'pivot' adds a value to the pipeline_steps_op_check constraint (V50 pattern). Flyway V-numbers are NOT hardcoded — re-confirm the current max immediately before writing the migration AND again before the delivery push (concurrent lanes may contend). As of kickoff, main is at V64 (HEL-378 datebucket, PR #279, merged) — next free is likely V65.
* Delivery is manual-merge-on-green (no branch protection): after the PR is green, PAUSE and present it to the human — do NOT merge and do NOT use `gh pr merge --auto`.

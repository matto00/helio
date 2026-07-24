# HEL-389: Pipeline op: string-ops (split / extract-regex / concat / case / trim on a value)

## Context

Common per-value string cleaning (trim, upper/lower, split-and-take, regex-extract, concat) currently forces a `compute` expression or isn't possible. This op offers a small string-operation DSL that writes a derived string column. NOTE: this is distinct from the existing `splittext` op, which explodes a `string-body` content field into multiple ROWS — this op does per-value column transforms and does not change row count. Existing ops live in `backend/src/main/scala/com/helio/domain/steps/`; study `ComputeStep.scala` (appends one derived column) as the template.

## Scope

Backend:

* New `backend/src/main/scala/com/helio/domain/steps/StringOpsStep.scala` — `StringOpsConfig(operation: String, field: String, outputColumn: String, pattern: Option[String], separator: Option[String], index: Option[Int], fields: Option[Vector[String]])` + tolerant `decode` + `StringOpsStep.evaluate` + `companion`. Operations: `trim`, `upper`, `lower`, `split` (split `field` by `separator`, take `index`), `extractRegex` (first `pattern` group), `concat` (join `fields` with `separator`). Writes a `string` value to `outputColumn` (may overwrite `field`). Unsupported operation fails at execute time with a descriptive error. No inline fully-qualified names.
* `PipelineStep.scala` — register + `PipelineStepKind.StringOps`.
* `PipelineStepProtocol.scala` — `StringOpsStepResponse` + format + `jsonFormat6` + union arms + `fromDomain`.
* `PipelineStepConfigCodec.scala` — `encodeConfig` + `extractConfig` arms.
* `PipelineAnalyzeService.scala` — dispatch case + `inferStringOps`: output = input schema + `outputColumn` typed `string` (append if new, replace if it collides).
* `PipelineAnalyzeProtocol.scala` — `StringOpsAnalyzeStepResponse` + union arms.
* Flyway migration — extend `pipeline_steps_op_check` to add `'stringops'` (drop/re-add per `V50__add_splittext_op.sql`). Next available VNN, assigned at scheduling time (main at V59; three v1.6 lanes may contend). **MERGE HAZARD**: re-confirm the actual current max via `ls backend/src/main/resources/db/migration/ | sort` immediately before writing the migration AND again right before the delivery push (main may have moved since planning — as of orchestration start, main is at V69 after HEL-388/PR #284, so next free is likely V70, but re-check, don't assume).

Frontend:

* `types/pipelineStep.ts` — `StringOpsConfig` wire type.
* `state/stepNarrowing.ts` — `OP_TYPES` entry (label + icon), `defaultConfigFor` case, `stringOpsConfigOf` helper.
* New `ui/StringOpsConfig.tsx` editor (operation dropdown that reveals the relevant params, field select, outputColumn); wire into `StepCard.tsx` + `useStepCardState.ts`.

MCP:

* `helio-mcp/src/tools/write.ts` — add `stringops` to `add_pipeline_step` + config shape. The `type` field on `add_pipeline_step` is free-text `z.string()`, NOT an enum — document the new op in the tool description string.

## Op-wiring checklist (from prior tickets in the HEL-336 epic — find each by grepping an existing op, e.g. `fillnull`/`cast`/`compute`)

* apply (execute) + infer (analyze) parity
* `allowedOps` surface
* Flyway migration adding the new op name to the `pipeline_steps_op_check` constraint
* Frontend StepCard config editor + co-located `.test.tsx` (CONTRIBUTING binds the test)
* `pipelineStep.ts` needs 4 additions per op
* exhaustive-match consumers: `domain/package.scala`, `PipelineStepRepository.rowToDomain`, `PipelineService.toAnalyzeStepResponse`, `stepNarrowing.ts` (frontend)

## Design note (pin explicitly, with a test)

string-ops writes a DERIVED STRING COLUMN. It's most like `ComputeStep` (per-row derived column) or `CastStep` (per-field transform). The design must pin:

* the operation set: `split`-and-take-index / `extractRegex` (first pattern group) / `concat` (join fields) / `upper`/`lower`/case / `trim`
* the output column: append new vs overwrite existing — and how the analyze/infer schema reflects that: if it appends a column the infer path must add it as string; if it overwrites in place it's schema-preserving
* per-value null/missing handling
* regex-failure/no-match handling (null vs empty vs passthrough)

Study `ComputeStep` (derived column + `inferCompute` which APPENDS) and `CastStep` (per-field, schema-preserving) — the choice between append-vs-overwrite semantics determines whether infer is identity or additive, so pin it explicitly with a test.

## Acceptance criteria

- [ ] Each operation (trim/upper/lower/split/extractRegex/concat) produces the correct string into `outputColumn`; row count unchanged; unsupported operation fails with a descriptive error.
- [ ] `analyze_pipeline` yields `outputColumn` typed `string` (apply/infer parity for the appended/overwritten column).
- [ ] `pipeline_steps` op CHECK accepts `'stringops'`; migration applies cleanly.
- [ ] Frontend StepCard renders a working editor whose fields adapt to the chosen operation; config PATCHes round-trip.
- [ ] MCP `add_pipeline_step` lists `stringops` + config shape.
- [ ] Tests: round-trip execution (each operation) in `InProcessPipelineEngineSpec.scala`; analyze-schema test; codec round-trip; `PipelineStepSpec.scala` kind-parity updated.
- [ ] Backward compatible: additive; existing pipelines/rows unaffected; the row-exploding `splittext` op is untouched.

## Out of scope

* Row-exploding text splitting (that is `splittext`).
* DAG/branching — chains linearly.

## Dependencies

* None.

## Delivery note

Delivery is manual-merge-on-green (no branch protection): after the PR is green, PAUSE and present it to the human with the URL — do NOT merge automatically and do NOT use `gh pr merge --auto`.

# HEL-454: Assertion rule model + `assert` pipeline step

## Description

Pipelines produce the DataTypes that panels bind to, but nothing lets a pipeline assert expectations about its own output — the automated analog of helio-news's manual figure fact-checking. This ticket adds the assertion RULE MODEL and a new pass-through `assert` pipeline step, reusing the established per-step-file ADT pattern. Evaluation + per-run result persistence is a separate ticket (419-B); this one lands the step scaffolding, config codec, schema-inference entry, and editor UI so an assert step can be created, persisted, and analyzed (it passes rows through unchanged for now).

The step ADT is documented in `backend/src/main/scala/com/helio/domain/PipelineStep.scala`: each kind is a self-contained module under `domain/steps/` (see `FilterStep.scala`, `AggregateStep.scala`) owning its `*Config`, the `*Step` case class implementing `evaluate`, its JSON codec, and a `Companion` registered in `PipelineStep.Registry`. The op discriminator is also gated by a `pipeline_steps.op` CHECK constraint extended per new op (see `V50__add_splittext_op.sql`). Schema inference lives in `PipelineAnalyzeService.scala` (`inferOutputSchema` dispatch).

## Scope

* Backend step module `backend/src/main/scala/com/helio/domain/steps/AssertStep.scala`: `AssertConfig` = `Vector[AssertRule]`, where `AssertRule(kind: String, field: Option[String], params: JsObject, severity: String)`. Supported `kind` values for v1: `notNull`, `unique`, `range` (params `min`/`max`), `rowCountMin`/`rowCountMax` (params `count`), `regex` (params `pattern`). `severity` ∈ `warn|error`. `evaluate` returns the input rows UNCHANGED (identity pass-through) — rule evaluation/recording is 419-B. Provide tolerant `decode` (missing keys → empty rules) matching the `FilterConfig.decode` precedent, plus the `Companion` (`decodeConfig`/`encodeConfig`/`readFromWire`/`writeToWire`).
* Register `AssertStep.Kind` (`"assert"`) in `PipelineStep.Registry` and add the constant to `PipelineStepKind` (both in `PipelineStep.scala`). The kind-set parity test in `PipelineStepSpec` must stay green.
* Flyway migration (next available VNN, assigned at scheduling time — main at V59; do NOT hardcode) extending the `pipeline_steps_op_check` CHECK constraint to include `'assert'`, following the drop/re-add pattern of `V50__add_splittext_op.sql`.
* Schema inference: add an `"assert"` case to `PipelineAnalyzeService.inferOutputSchema` returning `(inputSchema, None)` (identity, like `filter`/`limit`/`sort`), with a `validationError` when a referenced `field` is absent from the input schema or `kind`/`severity` is not in the allow-list.
* Frontend: `AssertConfig.tsx` editor under `frontend/src/features/pipelines/ui/` following the `FilterConfig.tsx` pattern, wired into `StepCard.tsx`/`OpDropdown.tsx` and the step type unions in `frontend/src/features/pipelines/types/`.
* Do NOT inline fully-qualified names in Scala.

## Acceptance criteria

- [ ] An `assert` step persists, round-trips through the codec (`decodeConfig`/`encodeConfig`) and the wire (`readFromWire`/`writeToWire`), and appears in `PipelineStep.Registry`; the `PipelineStepSpec` parity test passes.
- [ ] The Flyway migration extends the op CHECK constraint to accept `'assert'` (drop/re-add pattern) without dropping any existing op.
- [ ] `analyze_pipeline` returns identity output schema for an assert step and a `validationError` when a rule references an unknown field or an invalid `kind`/`severity`.
- [ ] `AssertConfig.decode` tolerates partial/legacy configs (empty rules default) without throwing.
- [ ] The `AssertConfig.tsx` editor lets a user add/remove rules (kind, field, params, severity) and is reachable from the op dropdown; a Jest test covers it.
- [ ] `sbt test` and `npm test` pass; no FQNs inlined.

## Out of scope

* Rule EVALUATION and per-run pass/fail persistence (419-B). `referential` cross-DataType assertions (future) — v1 rule set is the six kinds above.
* Fail policy / blocking the DataType update (419-C).

## Dependencies

* None — foundational for the epic. Downstream: 419-B/C/D/F.

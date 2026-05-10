## Context

The `compute` op exists in both `InProcessPipelineEngine` (`applyCompute`) and
`PipelineAnalyzeService` (`inferCompute`), but the two methods expect different config shapes.
`applyCompute` uses `{"column","expression"}` while `inferCompute` uses
`{"outputs":[{"name","type"}]}`. This divergence would cause the analyze endpoint to produce
incorrect schema output once the frontend starts writing unified configs. The fix is to adopt a
single canonical shape and update `inferCompute` to read it.

## Goals / Non-Goals

**Goals:**
- Unified config shape `{"column":"...","expression":"...","type":"number"}` for compute steps
- `inferCompute` updated to read `column` + `type` keys
- `ComputeFieldConfig` React component: column name input + expression input + available fields hint
- Wire `compute` case in `StepCard` inside `PipelineDetailPage`
- Backend and frontend tests

**Non-Goals:**
- Multi-output compute steps
- Expression builder / autocomplete UI
- Spark execution path

## Decisions

**Unified config shape**: `{"column": "fieldName", "expression": "fieldA / fieldB", "type": "number"}`
- `column` — output field name (string)
- `expression` — arithmetic expression string (evaluated by `ExpressionEvaluator`)
- `type` — declared output type for schema inference (string, same type vocabulary as cast op)
- Rationale: one JSON object per step-row; no nested arrays needed for single-output compute.
  Simpler to parse, simpler to display, consistent with cast/rename/select config shapes.

**`inferCompute` update**: Read `column` and `type` directly instead of the `outputs` array.
The existing `parseConfig` helper handles parse/extraction failures safely. No other callers of
`inferCompute` exist outside of `analyze` — change is safe.

**`applyCompute` unchanged**: already reads `column` and `expression`; extra `type` key in JSON is
ignored by Spray JSON field access (`cfg.fields("column")` etc.). No changes required.

**ExpressionEvaluator reuse**: The evaluator already supports arithmetic (+,-,*,/), parentheses,
numeric/string literals, and field references. Failed evaluations return `Left(EvaluationError)`;
`applyCompute` already maps `Left(_) => null`. No changes required.

**Frontend component pattern**: Follow `CastFieldsConfig`/`FilterConfig` — stateless props-driven
component that calls `updatePipelineStep` on change. State is lifted to `StepCard` using the same
during-render sync pattern already used for `selectedFields`, `renames`, `casts`, and `filterConfig`.

**Available fields hint**: Show the `analyzeColumns` list as a read-only hint below the expression
input (not a full picker). Keeps the component simple; users can reference field names directly.

**Initial config**: `{"column":"","expression":"","type":"number"}` — created by `handleAddStep` in
`PipelineDetailPage` for `opType.id === "compute"`, following the same pattern as other ops.

## Risks / Trade-offs

- [Config migration for existing `compute` steps with `outputs[]` shape] → No prod data at risk;
  analyze service returns schema-fallback on parse error so existing steps degrade gracefully.
- [Expression syntax errors at runtime] → `ExpressionEvaluator` returns `Left`; `applyCompute`
  maps to `null` per row — no crash, no data loss.

## Planner Notes

- Self-approved: no breaking API changes, no new external dependencies, no DB migrations.
- Config divergence between `inferCompute` and `applyCompute` was the pre-existing risk identified
  in ticket planning notes — addressed directly by the unified shape.

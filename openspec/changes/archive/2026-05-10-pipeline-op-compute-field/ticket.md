# HEL-191 — Pipeline operation: Compute field

## Title
Pipeline operation: Compute field

## Description
Step type: add a derived field via an expression referencing existing fields (e.g. revenue / users,
price * quantity). UI: output field name + expression input. Backend evaluates expressions safely
(no arbitrary code execution).

## Acceptance Criteria

1. Users can add a "Compute column" step to a pipeline.
2. The step config UI shows: output field name (text input) + expression input (text input).
3. Available fields for the expression are discovered via `GET /api/pipelines/:id/analyze`
   (the `useAnalyzePipeline` hook pattern / per-step `inputSchema`).
4. The backend evaluates expressions safely using the existing `ExpressionEvaluator` — supports
   arithmetic (+, -, *, /), parentheses, numeric literals, and field references. No eval/arbitrary
   code.
5. Failed evaluations (division by zero, unknown field) produce `null` for that row — no crash.
6. The new computed column is appended to the row output.
7. The analyze endpoint (`inferCompute`) and execution engine (`applyCompute`) share a single
   unified config shape: `{"column": "fieldName", "expression": "...", "type": "number"}`.
8. The config component follows the pattern of CastFieldsConfig / FilterConfig — receives
   `analyzeSchema` / `analyzeColumns` and calls `updatePipelineStep` on change.
9. Adding a compute step produces an initial config: `{"column":"","expression":"","type":"number"}`.
10. Tests: ComputeFieldConfig unit test + backend `applyCompute` / `inferCompute` test.

## Context Notes (from orchestrator)

- `applyCompute` in `InProcessPipelineEngine` currently uses `{"column":"...", "expression":"..."}`.
- `inferCompute` in `PipelineAnalyzeService` currently uses `{"outputs": [{"name":"...", "type":"..."}]}`.
- These MUST be unified to a single config shape. Agreed canonical shape:
  `{"column": "outputField", "expression": "fieldA / fieldB", "type": "number"}`.
- `inferCompute` must be updated to read `column` + `type` keys (not `outputs` array).
- `applyCompute` already reads `column` + `expression` — just needs `type` to be ignorable.
- `ExpressionEvaluator` already exists and is production-quality — use it as-is.
- Use `useAnalyzePipeline` hook pattern. The `analyzeColumns` prop fed to the config component
  gives available field names for display/hint purposes.
- Initial config when step is added: `{"column":"","expression":"","type":"number"}`.
- Config is saved on each field change (blur or change event), same pattern as FilterConfig.

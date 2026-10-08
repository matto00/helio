## Why

The pipeline `compute` step's expression language only offers string functions (`concat`, `substring`, `lower`,
`upper`, `length`). Rounding a percentage or bucketing a value (helio-news CI Health dashboard) had to be done outside
Helio, in Python. Basic numeric functions close that gap without a new op.

## What Changes

- Add five numeric functions to the compute expression language: `floor(x)`, `ceil(x)`, `round(x)` /
  `round(x, digits)`, `mod(a, b)`, `abs(x)`.
- Arity is checked at parse time like the existing functions; null arguments propagate to null; a non-numeric
  argument is a per-row type error (row value `null`), matching the existing strict `-`/`*`/`/` operators;
  `mod(a, 0)` is a per-row division-by-zero (row value `null`), matching `/`.
- Type inference reports every numeric function as the canonical numeric type the evaluator already emits for
  arithmetic (`"float"`), so analyze-time types match run-time values.
- The unknown-function parse error now lists every supported function name.
- Update `docs/compute-expression-grammar.md` (function table, inference section) to match.

## Capabilities

### New Capabilities

### Modified Capabilities
- `compute-expression-language`: the supported function set grows (numeric functions with defined rounding/modulo/null
  semantics), the unknown-function error lists supported functions, and the inference requirement covers the new
  functions (and states the canonical `"float"` wire value the code already emits).

## Impact

- Backend: `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala` (+ its spec). The change applies
  to every caller of the evaluator: `ComputeStep` (run/preview), `PipelineAnalyzeService.inferCompute` (analyze),
  `PipelineService` capability validation, `PatchSetPreviewProjection`, `SourceService.applyComputedFields`.
- No API shape, schema, DB, or Flyway change; the `compute` op already exists.
- Frontend: none required — the step card renders the backend's `validationError` verbatim and has no client-side
  function list or validator.

## Non-goals

- Unary minus / negative literals, conditionals or comparisons (HEL-1070), date arithmetic (HEL-1314), aggregate
  functions (HEL-1310).
- Coercing numeric strings to numbers (existing operators are numeric-strict; a `cast` step is the supported path).
- The dormant Spark path (`SparkJobSubmitter` passes expressions to Spark SQL verbatim; already divergent).

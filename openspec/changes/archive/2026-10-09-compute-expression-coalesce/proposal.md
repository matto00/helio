## Why

Since HEL-1408 (7ed15758) a blank CSV cell loads as `null`, and every compute function is null-propagating, so
`concat($first, " ", $last)` is `null` whenever either part is blank. The expression language has no way to supply a
fallback for a null value. The owner ruled (HEL-1408 Q5) to keep null propagation and add `coalesce()`.

## What Changes

- New variadic compute-expression function `coalesce(a, b, ...)` (arity ≥ 2): returns the first argument that is not
  `null`, evaluating arguments left to right and stopping at the first non-null one. It is the one function exempt
  from null propagation; all-null → `null`.
- Output type inference: the common type of the arguments (identical → that type; numeric mix → `float`; text-like
  mix → `string`). Mixing a numeric argument with a text-like one is an **analyze-time validation error** on the
  compute step (owner ruling on HEL-1423, option `analyze-error`). Save stays parse-only; scheduled/auto/manual runs
  are not gated by it (see design D5).
- `docs/compute-expression-grammar.md` and the `compute-expression-language` spec updated; the supported-function
  list (and the unknown-function error message that quotes it) gains `coalesce`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `compute-expression-language`: function list/arity gains `coalesce`; type inference gains the common-type rule and
  the mixed-type inference error; new requirement for `coalesce` semantics.

## Impact

- Backend: `ExpressionEvaluator` (function list, arity, lazy evaluation, inference), `PipelineAnalyzeService.inferCompute`
  (surface an inference error as the step's `validationError`). Tests in `ExpressionEvaluatorSpec`,
  `PipelineAnalyzeServiceSpec`, `ComputeStepSpec`, and a CSV-blank end-to-end spec.
- Docs/spec only otherwise. No frontend change, no migration, no API shape change.

## Non-goals

- Conditionals/boolean logic (`if`, comparisons) — HEL-1070. Unary minus / analyze-time numeric-function warnings —
  HEL-1403. Splitting `ExpressionEvaluator.scala` — HEL-1404. The Spark `F.expr` path (pre-existing divergence).

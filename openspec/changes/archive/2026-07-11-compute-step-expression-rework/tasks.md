## 1. Backend — grammar

- [x] 1.1 Add `Token.Ref`/`$`-sigil tokenizing to `ExpressionEvaluator`'s tokenizer
- [x] 1.2 Reject bare identifiers not followed by `(` as a parse error (strict grammar)
- [x] 1.3 Add `Token.FnName` + call-argument-list parsing; add `Call(name, args)` to the AST
- [x] 1.4 Freeze the pre-existing bare-identifier tokenizer/parser as private `parseLegacy`
      (no behavior changes — verbatim copy of today's parser)
- [x] 1.5 Keep `parse()` (used by `validate()`) strict-only — no fallback. Add legacy fallback
      only inside `evaluate()`: on the "$' prefix" parse error, retry via `parseLegacy` and
      evaluate that AST (design.md Decision 4 — do NOT wire the fallback into shared `parse()`)
- [x] 1.6 Add `ExpressionEvaluator.validateTolerant(expr, fieldNames)`: same strict-first/
      legacy-fallback shape as `evaluate()`, but for validation (used only by `DataTypeService`,
      task 2.4) — preserves today's bare-identifier-accepting validation behavior for DataType
      computed fields, unchanged by this ticket
- [x] 1.7 Implement `applyFn` for `concat`, `substring` (clamped range), `lower`, `upper`, `length`
      with arity/type checks per design.md Decision 3
- [x] 1.8 Route `Call` through `applyFn` in `evalExpr`; keep `applyOp` unchanged for `BinOp`

## 2. Backend — type inference and validation wiring

- [x] 2.1 Implement `ExpressionEvaluator.inferType(expr, fieldTypes)` walking the AST per
      compute-expression-language spec (number/string propagation rules)
- [x] 2.2 Update `PipelineAnalyzeService.inferCompute` to call `ExpressionEvaluator.validate`
      (strict) on the expression first; on `Left(msg)` set `AnalyzedStep.validationError =
      Some(msg)` and keep the wire `type` for the output field; on `Right(_)` call `inferType`
      and use its result instead of the wire `type` (design.md Decision 5)
- [x] 2.3 Confirm `ComputeStep.apply` (execution, via `evaluate`) and `inferCompute` (analyze, via
      `validate`) both route through the shared strict `parse()` except for the legacy-fallback
      case (apply/infer parity)
- [x] 2.4 Switch `DataTypeService.validateExpression` and `applyUpdate`'s `exprError` check to
      `ExpressionEvaluator.validateTolerant` (task 1.6) instead of `validate`, so DataType
      computed-fields saves/validation behavior is unaffected by the stricter pipeline-compute-op
      grammar (design.md Decision 4 — DataTypeService boundary)
- [x] 2.5 Confirm `SourceService.applyComputedFields` continues to use `evaluate` (legacy-tolerant
      by task 1.5) — no change needed, but verify with a regression test (task 5.9)

## 3. Frontend

- [x] 3.1 Add `validationError?: string` prop to `ComputeFieldConfig`; render inline below the
      expression input using the `shared-inline-error` component/pattern
- [x] 3.2 Thread the per-step `validationError` from `useStepCardState`/`StepCard` down to
      `ComputeFieldConfig` (same path `analyzeColumns` already takes)
- [x] 3.3 Prefix the available-fields hint list with `$` (e.g. `$price`) to match required syntax
- [x] 3.4 Update `ComputeFieldConfig`'s expression placeholder text to show `$`-prefixed and
      function-call examples

## 4. Documentation

- [x] 4.1 Write `docs/compute-expression-grammar.md`: literals, `$col` refs, operators + precedence,
      function catalog (concat/substring/lower/upper/length), coercion rules, error cases —
      referenced from both `ExpressionEvaluator.scala`'s doc comment and `ComputeFieldConfig.tsx`

## 5. Tests

- [x] 5.1 `ExpressionEvaluatorSpec`: `validate()` is strict — accepts `$col`, rejects bare `col`
      unconditionally (no legacy fallback in `validate()`/`parse()`)
- [x] 5.2 `ExpressionEvaluatorSpec`: each function (`concat`, `substring` incl. clamped range,
      `lower`, `upper`, `length`) — happy path, arity error, type error
- [x] 5.3 `ExpressionEvaluatorSpec`: numeric-strict / `+`-permissive coercion cases (subtraction
      of a string is a `TypeError`; `+` coerces number-to-string either side)
- [x] 5.4 `ExpressionEvaluatorSpec`: `evaluate()`'s `parseLegacy` fallback — a stored
      bare-identifier expression still evaluates identically to its pre-change output, while
      `validate()` on that same expression still returns `Left` (proves the split, not a shared
      loophole)
- [x] 5.5 `ExpressionEvaluatorSpec`: `validateTolerant()` accepts bare identifiers (matches
      today's `validate()` behavior verbatim, for the `DataTypeService` call sites)
- [x] 5.6 `ExpressionEvaluatorSpec`/new `inferType` spec: number/string propagation for arithmetic,
      concat, substring/lower/upper, length, and unknown-field error case
- [x] 5.7 `PipelineAnalyzeService` spec: `inferCompute` sets `validationError` and falls back to
      wire `type` for an invalid/legacy expression; derives type from expression (ignoring a
      stale wire `type`) when the expression is valid
- [x] 5.8 Frontend `ComputeFieldConfig` test: renders inline `validationError` when present;
      renders `$`-prefixed field hints
- [x] 5.9 `DataTypeService`/`SourceService` regression: a DataType with an existing bare-identifier
      computed field still passes `PATCH /api/types/:id` validation and still evaluates correctly
      (proves the DataTypeService boundary is unaffected)
- [x] 5.10 Existing single-column compute regression: a currently-passing compute test using the
      old bare-identifier syntax still passes unmodified via `evaluate()`'s fallback (proves
      back-compat for the pipeline compute step)

# Files modified — HEL-262 (compute-step-expression-rework)

## Backend — engine

- `backend/src/main/scala/com/helio/domain/ExpressionEvaluator.scala` — full grammar rewrite: `$`-prefixed
  `Token.Ref`, `Token.FnName` + comma-separated call-argument parsing, `Call(name, args)` AST node;
  new `StrictParser` (bare identifiers are always a parse error) and a frozen, verbatim-copy
  `LegacyParser` (bare identifiers accepted, unchanged from the pre-existing parser); `applyFn` for
  `concat`/`substring`/`lower`/`upper`/`length` (arity + type checks, `substring` clamps out-of-range
  indices, null-propagating like `applyOp`); new public `inferType(expr, fieldTypes)`; new public
  `validateTolerant(expr, fieldNames)`; `evaluate()` now retries via `parseLegacy` only on the exact
  "$' prefix" parse error (design.md Decision 4) — `validate()`/`parse()` stay strict-only forever.

## Backend — wiring

- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — `inferCompute` now calls
  `ExpressionEvaluator.validate` (strict) first; on failure sets `AnalyzedStep.validationError` and
  falls back to the wire `type`; on success calls `ExpressionEvaluator.inferType` and uses its result
  instead of the wire `type`. JSON-shape errors (missing/malformed keys) are caught by the same
  `try`/`catch` as before, so they never reach the new expression-validation logic.
- `backend/src/main/scala/com/helio/services/DataTypeService.scala` — `validateExpression` and
  `applyUpdate`'s `exprError` check switched from `ExpressionEvaluator.validate` to the new
  `validateTolerant`, preserving today's bare-identifier-accepting behavior for DataType computed
  fields (whose save path hard-blocks the whole PATCH on any invalid expression) — design.md
  Decision 4, "DataTypeService boundary". `SourceService.applyComputedFields` and `ComputeStep.apply`
  needed no code change — both already call `evaluate`, which is legacy-tolerant by construction.

## Backend — tests

- `backend/src/test/scala/com/helio/domain/ExpressionEvaluatorSpec.scala` — rewritten: `validate()`
  strict-grammar coverage ($-required, function arity/unknown-name errors), `validateTolerant()`
  bare-identifier acceptance, `inferType` number/string propagation, `evaluate()` coverage for the
  new grammar (multi-column refs, numeric constants, string functions, numeric-strict/`+`-permissive
  coercion, null propagation through function args) plus explicit legacy-fallback regression tests
  (bare-identifier expression evaluates unchanged while `validate()` on the same string still
  rejects it).
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — compute-op tests
  updated to `$`-prefixed expressions where `validationError shouldBe None` is asserted (since bare
  identifiers are now flagged); added tests for output-type inference overriding a stale wire `type`,
  a legacy bare-identifier expression being flagged with `validationError` while still appending the
  wire-typed field, and an unknown `$`-prefixed field reference being flagged.
- `backend/src/test/scala/com/helio/services/DataTypeServiceSpec.scala` — added regression coverage
  proving the `DataTypeService` boundary: a bare-identifier computed-field expression still passes
  both `validateExpression` and `update`/`applyUpdate` unmodified.

## Frontend

- `frontend/src/features/pipelines/ui/ComputeFieldConfig.tsx` — new `validationError?: string` prop
  rendered inline via the shared `InlineError` component (same pattern as `AggregateConfig`); the
  available-fields hint list is now `$`-prefixed; expression placeholder text shows a `$`-prefixed
  and function-call example.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — threads a new `validationError?: string` prop
  down to `ComputeFieldConfig` (compute op only).
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — new `getAnalyzeValidationError`
  callback prop, threaded to `StepCard` per step (same pattern as `getAnalyzeColumns`/`getAnalyzeSchema`).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — new `getAnalyzeValidationError`
  helper reading `AnalyzeStepResult.validationError` for a given step id (mirrors `getAnalyzeColumns`).
- `frontend/src/features/pipelines/ui/ComputeFieldConfig.test.tsx` — updated available-fields hint
  assertions to expect the `$`-prefix; added tests for rendering (and not rendering) the inline
  `validationError`.

## Documentation

- `docs/compute-expression-grammar.md` — new shared grammar doc: literals, `$col` refs, operator
  precedence/coercion table, function catalog, error surfacing, output-type inference rules, legacy
  compatibility (design.md Decision 4), and known limitations (no unary minus, no boolean/comparison
  operators, no autocomplete).

## OpenSpec

- `openspec/changes/compute-step-expression-rework/` — proposal/design/tasks/specs (all tasks
  checked off) for this change.

## Why

`backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala` is 741 lines at origin/main 0f95ec49, almost
3x CONTRIBUTING.md's ~250-line soft budget and over its ~400-line "propose a split" line. One `object` holds four
concerns: the tokenizer, the strict and legacy recursive-descent parsers with their AST, static type inference
(including HEL-1423's `coalesce` common-type rule), and the row evaluator with function dispatch. HEL-1403 (unary minus)
is queued next and would otherwise land in the same file.

## What Changes

- Move the tokenizer, the parsers + AST, type inference, and evaluation/function dispatch out of
  `ExpressionEvaluator.scala` into focused files in the same package, bodies byte-identical.
- `ExpressionEvaluator` keeps its name, package, and every public and `private[engine]` member with an unchanged
  signature: `parseProblem`, `validate`, `validateTolerant`, `inferType`, `compile`, `evaluate`, `CompiledExpression`,
  `unknownFieldMessage`, `SupportedFunctions`, `NumericFunctions`. `EvaluationError` stays in the same file.
- `SupportedFunctions`/`NumericFunctions` stay defined once, in `ExpressionEvaluator`; the moved code reads them from
  there.
- No behaviour change, no wire change, no test-source change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Pure structural refactor; `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- HEL-1403 (unary minus / negative literals) and HEL-1070. No grammar change of any kind.
- Fixing defects or oddities found while moving code. They become follow-up candidates.
- Changing any caller (`ComputeStep`, `ColumnSchemaInference`, `PipelineService`, `PatchSetPreviewProjection`, specs).
- Editing comments in other files that name `ExpressionEvaluator.<member>` (they still resolve through the entry point).

## Impact

- Backend only: `domain/engine/` gains four files; `ExpressionEvaluator.scala` shrinks to roughly 250 lines.
- `domain/engine/README.md` Holds list updated. `docs/compute-expression-grammar.md` still names `ExpressionEvaluator.scala`
  as the backend side of the contract; that stays true (it is the entry point), so the doc is not edited.
- Concurrent lanes HEL-1429 / HEL-1399 / HEL-1430 touch no file in this change.

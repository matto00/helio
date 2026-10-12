## Why

The pipeline `compute` step has arithmetic, text and date functions but no comparison, boolean or conditional
construct, so a single pipeline cannot conditionally aggregate ("count rows where status = Done"). The roadmap
dashboard had to fall back to a hand-maintained `static` percentage next to live counts (HEL-1070).

## What Changes

Owner rulings (escalation 2026-10-11, all option A) fix the grammar:

- Conditional function `if(cond, then, else)` (nest for multiple branches). Only the chosen branch is evaluated.
- Comparison operators `=`, `!=`, `<`, `<=`, `>`, `>=` (non-associative) and boolean operators `and`, `or`, `not`
  with SQL precedence (`or` < `and` < `not` < comparison < `+ -` < `* /` < unary `-`), plus `true`/`false` literals.
- A boolean value type: comparisons and boolean operators produce JSON `true`/`false`, inferred type `boolean`.
  A boolean column now reads as a boolean in expressions (it read as the text `"true"`); `+` still concatenates it.
- SQL three-valued null logic; `if` with a `null` condition takes the else branch.
- Strict comparison typing: number vs text is an analyze-time error and a per-row `null`; text compares by
  code unit; booleans support only `=`/`!=`; timestamps compare as text (use `seconds_between` for instants).
- `if` branch types follow the `coalesce` rule (same type; integer/float mix -> float; any other mix is an
  analyze-time error). `coalesce` mixing boolean with non-boolean also becomes an analyze-time error.
- The shared fixture gains the operator/keyword list; the compute editor help, helio-mcp description and
  `docs/compute-expression-grammar.md` document the new grammar.

## Capabilities

### New Capabilities

### Modified Capabilities

- `compute-expression-language`: adds comparison, boolean and conditional syntax and semantics, a boolean value
  type, and extends output-type inference (boolean, `if`, `+` with booleans, `coalesce` with booleans).

## Non-goals

- `case when ... end`, ternary, `&&`/`||`/`!` syntax (owner chose A on each).
- Timestamp-aware (instant) comparison; a `null` literal or `is null` operator; aggregate functions in compute.
- HEL-1491 (fillnull mean/median and union timestamp type bugs) - separate ticket.
- The Spark `F.expr` path (pre-existing divergence, documented).
- Rebuilding the roadmap dashboard's `%` tiles (a data follow-up once this ships).
- The frozen legacy bare-identifier grammar gains nothing.

## Impact

Backend `domain/engine` Expression* (tokenizer, parser, type inference, interpreter, numeric contexts),
`shared-test-fixtures/compute-expression-functions.json` + its three seam tests, frontend
`computeFunctionReference.ts`/`ComputeFieldConfig.tsx`, helio-mcp `computeExpression.ts`, and the grammar doc.
No API shape, schema, migration, or new pipeline op.

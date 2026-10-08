## Context

`ExpressionEvaluator` (backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala) is the single
evaluator behind the compute step. One strict parser (`StrictParser` + `checkArity`) serves both the analyze path
(`validate` + `inferType`, called by `PipelineAnalyzeService.inferCompute` and `PipelineService` capability checks) and
the run path (`compile`/`eval`, called by `ComputeStep.apply`; also `SourceService.applyComputedFields`). So grammar
parity between infer and apply is structural; the parity risk is result *types* and per-row *semantics*.

Existing conventions this change must match (read from the file, not assumed):
- Values are `VNum(Double) | VStr | VNull`; every numeric result is emitted as `JsNumber(Double)` and `inferType`
  reports every numeric expression as `"float"` (`length` and arithmetic alike).
- `applyFn` returns `VNull` if any argument is `VNull` (null propagation).
- `-`/`*`/`/` are numeric-strict: a `VStr` operand (including a numeric string such as `"5"`, which is what an uncast
  CSV column holds) is `EvaluationError.TypeError`; `/` by zero is `EvaluationError.DivisionByZero`.
  `ComputeStep.apply` maps any per-row `Left` to `null` for that row.
- Unknown names/arity fail in `checkArity` at parse time with `'<name>' is not a recognized function`.
- No unary minus: a negative value reaches a function only via a field or `0 - x`.

## Goals / Non-Goals

**Goals:** `floor`, `ceil`, `round(x[, digits])`, `mod(a, b)`, `abs` with defined semantics on negatives, null, and
non-numeric input; analyze-time type equals run-time value type; unknown-function error lists all functions.

**Non-Goals:** unary minus, numeric-string coercion, integer typing of results, Spark-path parity (see proposal).

## Decisions

**D1 — Numeric strictness, null propagation (match existing operators).** Every argument must be `VNum`; a `VStr`
(including `"3.7"`) is a `TypeError` naming the function (`floor requires a numeric argument, got string`), so the row
value is `null` — exactly what `$s - 1` does today. Null in any argument → `VNull` via the existing `applyFn` guard.
Alternative (coerce numeric strings) rejected: it would make `floor($s)` succeed where `$s - 0` fails, an
inconsistency inside one language; the supported path for CSV string columns remains a `cast` step.

**D2 — Arity at parse time.** `floor`/`ceil`/`abs`: 1; `mod`: 2; `round`: 1 or 2. Wrong arity is a parse error in
`checkArity` with the existing message shapes (`floor requires 1 argument`, `mod requires 2 arguments`,
`round requires 1 or 2 arguments`), so analyze, write-path `validateRawConfig`, and the HEL-1279 auto-run gate (all via
`validate`/`parseProblem`) reject it before any row runs.

**D3 — floor/ceil/abs.** `math.floor` (toward −∞: `floor(-2.5) = -3`), `math.ceil` (toward +∞: `ceil(-2.5) = -2`),
`math.abs`. Results stay `VNum(Double)`; a `-0.0` result is normalised to `0.0` so output never shows `-0`.

**D4 — round: half away from zero, optional digits.** `round(x)` = `round(x, 0)`. Implemented via
`BigDecimal.decimal(x).setScale(digits, RoundingMode.HALF_UP)` (Java `HALF_UP` rounds ties away from zero:
`round(2.5) = 3`, `round(-2.5) = -3`). `BigDecimal.decimal` uses the double's shortest decimal representation, so
`round(2.675, 2) = 2.68` (not the `2.67` a raw-binary rounding gives). This matches Excel/Sheets `ROUND` and Postgres
`round(numeric)`; banker's rounding (HALF_EVEN) rejected as surprising to dashboard users. `digits` must be a whole
number (`2.0` ok; `1.5` → `TypeError`); negative digits round to tens/hundreds (`round(1234, 0 - 2) = 1200`, Excel/Postgres
precedent). `digits` is clamped to `[-308, 308]` (substring-style clamping precedent) so a huge value from a field can
never allocate an unbounded `BigDecimal`. A non-finite `x` (overflow to ±Infinity via `*`) is returned unchanged
rather than passed to `BigDecimal` (which throws).

**D5 — mod: floored, sign follows divisor; mod by zero = per-row division by zero.** `mod(a, b) = a − b·floor(a/b)`,
computed as `r = a % b; if (r != 0 && (r < 0) != (b < 0)) r + b else r`. `mod(7, 3) = 1`, `mod(-7, 3) = 2`,
`mod(7, -3) = -2`, `mod(-7, -3) = -1`, `mod(5.5, 2) = 1.5`. Chosen for the bucketing use case that motivated the ticket
(a non-negative bucket index for a positive divisor) and Excel/Sheets/Python `MOD` precedent; truncated `%`
(Postgres/Spark/Java, `mod(-7,3) = -1`) rejected because it splits bucket 0 across the sign boundary.
`mod(a, 0)` → `EvaluationError.DivisionByZero` → row `null`, identical to `/`.

**D6 — Inference: every numeric function infers `"float"`.** Applied values are `JsNumber(Double)` like every other
numeric result, and `length`/arithmetic already infer `"float"`; inferring `"integer"` for floor/ceil/round would
claim a type the run path does not distinguish. Argument types are walked (unknown field still errors) but not
type-checked — consistent with `$s - 1` inferring `"float"` today. A parity test asserts, for each function, that
`inferType` returns `"float"` and `evaluate` on a numeric row returns a `JsNumber`.

**D7 — Single source of the function list.** A private ordered `SupportedFunctions` list drives the unknown-function
message: `'reverse' is not a recognized function; supported functions: abs, ceil, concat, floor, length, lower, mod,
round, substring, upper` (alphabetical). The existing prefix is preserved so substring assertions keep working; the one
exact-match assertion in `ExpressionEvaluatorSpec` is updated. A test asserts every name in the list passes
`checkArity` with a valid arity, so the list cannot drift from the dispatcher.

**D8 — Docs and spec.** `docs/compute-expression-grammar.md`: add the five functions to the table, the error example,
and the inference section (also correcting its stale `"number"` wording to the `"float"` the code emits). No
frontend change: `ComputeFieldConfig.tsx` renders `validationError` verbatim and has no function list/validator;
helio-mcp and assistant prompts do not enumerate compute functions (grepped).

## Risks / Trade-offs

- [Floored mod differs from SQL users' expectation] → documented in the grammar doc with a negative example.
- [Floating results such as `round(0.1 + 0.2, 2)`] → `BigDecimal.decimal` then `.toDouble` yields `0.3`; covered by test.
- [Legacy parser] → frozen; it never parses function calls, so no change there (new syntax only in `StrictParser`).

## Planner Notes

- Self-approved: D4 (half away from zero) and D5 (floored mod) are semantics choices with direct spreadsheet
  precedent, recorded here and surfaced in the delivery report; not escalated as product calls.
- Verified no Flyway/DB change: the op CHECK constraint covers op kinds; `compute` already exists.
- Driver claim (5) Spark: `SparkJobSubmitter` sends `F.expr(expression)` verbatim; pre-existing divergence, untouched.

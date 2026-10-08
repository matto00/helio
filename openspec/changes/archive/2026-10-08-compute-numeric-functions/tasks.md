## Standing Constraints

- [C1] Do not write a test that claims to guard `-0.0` normalisation: it is unobservable through JSON/string output, so such a test cannot fail.
- [C2] Never state or assert `0 <= mod(a, b) < b` as a guarantee (e.g. `mod(-1e-20, 3)` returns `3.0`); test exact documented cases only.
- [C3] The supported-function drift guard must be bidirectional: every listed name parses with a valid arity AND every name `checkArity`/`applyFn` accepts is in the list (e.g. probe a known candidate set), mutation-checked both ways.
- [C4] Use Scala `BigDecimal.RoundingMode.HALF_UP`, not `java.math.RoundingMode`.
- [C5] Every code-formatted expression example in docs/specs must be probed with `ExpressionEvaluator.validate` (or evaluate) and parse; the grammar has no unary minus, write negatives as `0 - x` or via a field.

## 1. Backend

### Backend

- [x] 1.1 Add `floor`/`ceil`/`abs` (1), `mod` (2), `round` (1|2) to `checkArity` in `ExpressionEvaluator.scala`; verify via 3.1 arity tests
- [x] 1.2 Add a private ordered `SupportedFunctions` list and append `; supported functions: <list>` to the unknown-function message (design D7); verify via 3.2
- [x] 1.3 Implement the five functions in `applyFn` per design D1/D3/D4/D5 (strict numeric, null-propagating, floored mod, HALF_UP round on `BigDecimal.decimal`, digits whole + clamped, non-finite passthrough, no `-0`); verify via 3.1
- [x] 1.4 Extend `inferTypeOf` so every numeric function infers `"float"` (design D6); verify via 3.3
- [x] 1.5 Update the file's header doc comment (function list) to include the new functions; verify by reading the diff

## 2. Docs

### Docs

- [x] 2.1 Update `docs/compute-expression-grammar.md`: function table (with negative/null/mod-by-zero examples), errors example, inference section (`"float"` wording); verify by reading the diff

## 3. Tests

### Tests

- [x] 3.1 `ExpressionEvaluatorSpec`: each function on positive, negative, zero, null, numeric-string inputs; round ties/digits/negative digits/fractional digits/huge digits/2.675; mod sign quadrants, fractional, by-zero; wrong-arity parse errors; verify with `sbt "testOnly *ExpressionEvaluatorSpec"`
- [x] 3.2 Unknown-function message lists all ten names; every listed name passes `validate` with a valid arity (drift guard, mutation-checked by removing one name); update the existing exact-match assertion
- [x] 3.3 Infer/apply parity test: for each numeric function, `inferType` = `"float"` and `evaluate` on numeric input yields a `JsNumber`
- [x] 3.4 Pipeline-level test (ComputeStep or analyze spec): a compute step using `round`/`mod` produces the expected column values and analyze reports `"float"` with no `validationError`; an unknown function surfaces the listing message as `validationError`; verify with `sbt testOnly` on the touched specs
- [x] 3.5 Run the full backend suite with `sbt testFull` (nice -n 19) and record the result

## Standing Constraints

- [C1] Red first: write the group-4 backend specs (and the fixture/seam changes) before any implementation; record the failing run in `red-evidence.md` in this change dir.
- [C2] Owner rulings Q1-Q6 = A (design.md Context) are fixed; do not deviate. No case-when, ternary, `&&`/`||`/`!`, null literal, or instant comparison.
- [C3] Every sbt run is `sbt testFull` (never bare `sbt test`) and its output must show the `[hel1468-guard]` summary line; `nice -n 19`; check MemAvailable >= ~15 GB first; shut down any sbt server started.
- [C4] No inline fully-qualified names (CONTRIBUTING.md); the frozen LegacyParser is never edited; HEL-1491 is out of scope.
- [C5] Precedence and short-circuit tests are mutation-proven: each mutation M1-M8 in 4.3 is applied, its named test observed red, then reverted; record in `mutation-evidence.md`.

### Backend

## 1. Tokenizer and parser

- [x] 1.1 Tokenizer: tokens for `=`, `!=`, `<`, `<=`, `>`, `>=` (design D1); keep `Ident`/`FnName` for keywords
- [x] 1.2 AST nodes `BoolLit`, `Cmp`, `And`, `Or`, `Not` (D3)
- [x] 1.3 StrictParser: or/and/not/cmp levels, non-associative comparison, `true`/`false`, case-insensitive keywords, keyword `FnName` (`and(`/`or(`/`not(`), reserved-word error (not the `$`-prefix error), `==`/`<>` hint errors (D1, D2)
- [x] 1.4 Register `if` in `SupportedFunctions` and `checkArity` (exactly 3); add `SupportedOperators` and `BooleanLiterals` vectors

## 2. Evaluation and inference

- [x] 2.1 Interpreter: `VBool` at EVERY `Val` match site listed in D4 (incl. `ExpressionDateTimeFunctions.instantOf` -> null, string functions read VBool as text); list the sites in the executor report
- [x] 2.2 Interpreter: `Cmp`, 3VL `And`/`Or`/`Not` with short-circuit, lazy `if` arm (D5)
- [x] 2.3 `inferTypeOf`: boolean kinds, comparison kind check (cast / seconds_between hint), boolean-operand checks, `if` + shared `commonType` with coalesce (D6)
- [x] 2.3b Boolean sub-expression used as a number (incl. `add_days` day count) is an inference error with the `if(cond, 1, 0)` hint (D6b)
- [x] 2.4 `checkRefs`, `ExpressionNumericContexts` (`textRefs` into `if` branches, TextTypes comment) updated (D7); grammar summary comment in `ExpressionEvaluator`

## 3. Seam fixture, frontend, helio-mcp, docs

- [x] 3.1 `shared-test-fixtures/compute-expression-functions.json`: add `if`, `operators`, `literals` (D8)
- [x] 3.2 Frontend `computeFunctionReference.ts` + `ComputeFunctionReference.tsx` disclosure (relabel "Functions and operators"): `if` and an operator reference (DESIGN.md)
- [x] 3.3 helio-mcp `COMPUTE_EXPRESSION_DOC`: `if`, operators, literals, null and typing rules
- [x] 3.4 `docs/compute-expression-grammar.md` per D9

### Tests

## 4. Backend specs (written first, per C1)

- [x] 4.1 Parser: every operator/keyword parses (incl. `and(`, `or(`, `not(`, upper-case keywords); chained comparison, `==`, `<>`, `if` arity 2/4, `$a = and`, bare `not` are parse errors with the reserved-word (not `$`-prefix) message; pin legacy `true`, `false`, `true * 2`, `and + 1`, `not` new behaviour and `price * qty`, `price * and`, `true + price`, `True + price` unchanged
- [x] 4.2 Evaluation: every spec scenario (numeric/text/boolean compare, mismatch -> null, full 3VL table, short-circuit, if branches + null cond + unselected-branch error, boolean column, `$flag + 1`, `length/upper/substring($flag)` = 4/"TRUE"/"t", boolean into seconds_between/date_trunc/add_days -> null via `ComputeStep.apply` without throwing)
- [x] 4.3 Precedence: `$a or $b and $c`, `not $a = $b`, `$a + 1 > $b * 2`, `not not $x`, `-$a < $b` with row values that distinguish each parse; mutation-prove (C5):
  - M1 swap or/and levels -> `$a or $b and $c` test red; M2 parse `not` below comparison -> `not $a = $b` test red
  - M3 make comparison associative -> `1 < $x < 5` parse-error test red; M4 drop `and` short-circuit -> `false and floor($s) > 1` test red
  - M5 drop `or` short-circuit -> `true or floor($s) > 1` test red; M6 evaluate both if branches -> `if($b = 0, 0, $a / $b)` test red
  - M7 null if-condition takes then -> null-cond test red; M8 `null and false` returns null -> 3VL table test red
- [x] 4.4 Analyze-vs-apply parity: for every new construct, `inferType` result matches the JSON type `ComputeStep.apply` produces (boolean/float/string), incl. `if` numeric mix and `$flag`
- [x] 4.5 Inference errors: `($s = "Done") * 1` and `floor($a > 1)` (D6b; bare `$flag * 1` still only warns), comparison kind mismatch (message carries the cast / seconds_between hint), boolean ordering, non-boolean and/or/not operand and if condition, if/coalesce boolean mix; surfaced as `validationError` via `inferCompute` while the step still saves
- [x] 4.6 Seam: backend fixture spec asserts functions, operators and literals both directions; existing specs (ExpressionEvaluatorSpec, unary minus, datetime, numeric contexts) stay green
- [x] 4.7 Conditional-count end to end: a pipeline compute `if($status = "Done", 1, 0)` + aggregate `sum` yields the Done count

## 5. Frontend and helio-mcp tests

- [x] 5.1 Jest: reference names == fixture (functions + operators + literals); disclosure renders `if` and operators
- [x] 5.2 helio-mcp test: description names every fixture function, operator and literal
- [x] 5.3 Lint, typecheck, format, and full gates green; `files-modified.md` one repo path per line

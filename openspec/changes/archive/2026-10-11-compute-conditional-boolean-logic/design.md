## Context

The compute grammar lives in `backend/src/main/scala/com/helio/domain/engine/`: `ExpressionTokenizer` (shared by
the strict parser and the FROZEN legacy parser), `ExpressionParser` (AST `NumLit/StrLit/FieldRef/BinOp(Char)/Neg/Call`,
`checkArity`, `checkCall`), `ExpressionTypeInference.inferTypeOf` (float/string/timestamp + `coalesceType`),
`ExpressionInterpreter` (`Val` = `VNum/VStr/VNull`; `JsBoolean` cells read as `VStr("true")`; `applyFn`; lazy
`coalesce` arm), `ExpressionNumericContexts` (numeric-op-on-text warning), `ExpressionEvaluator`
(`SupportedFunctions`, `NumericFunctions`, `DateTimeFunctions`, `checkRefs`, `inferType`, `compile`).
Analyze: `ColumnSchemaInference.inferCompute` (validate -> inferType; a `Left` from inferType is the step's
`validationError`, the step still saves). Run: `ComputeStep.apply` -> `compile` -> `valToJs`. Seam fixture
`shared-test-fixtures/compute-expression-functions.json` is read by `ComputeExpressionFunctionsSeamSpec`,
frontend `computeFunctionReference.test.ts`, helio-mcp `computeExpressionDescription.test.ts`.

Owner rulings (escalation raised 2026-10-11, answered A on all six; context in the run's
`evidence/escalation-1-context.md`): Q1 `if(cond, then, else)`; Q2 words `and/or/not`, `true/false`, SQL
precedence; Q3 JSON booleans typed `boolean`, boolean columns read as booleans, `+` still concatenates; Q4 SQL
three-valued logic, null condition -> else; Q5 strict typing, timestamps compare as text; Q6 coalesce branch rule.

## Goals / Non-Goals

**Goals:** conditional count/sum in one compute step; analyze/apply type parity for every new construct;
mutation-proven precedence; seam fixture agreement across backend, frontend, helio-mcp; documentation.

**Non-Goals:** see proposal (case-when, ternary, symbol operators, instant comparison, null literal, HEL-1491, Spark).

## Decisions

**D1 Tokens.** Add tokenizer cases for `=`, `!=`, `<`, `<=`, `>`, `>=` (one token each; `<>` and `==` are rejected
by the strict parser with a message suggesting `!=` / `=`; a lone `!` stays "Unexpected character"). Keywords are NOT
new tokens: the tokenizer keeps emitting `Ident`/`FnName` for `and/or/not/true/false`, and only the StrictParser
recognises them (case-insensitively). Reason: the tokenizer feeds the frozen `LegacyParser`; a keyword token would
change legacy token streams. `and(`, `or(`, `not(`, `true(`, `false(` arrive as `FnName`: the strict parser treats a
keyword `FnName` exactly like the keyword `Ident` (the following `(` is then an ordinary group), never as a function.
A keyword where a value is expected (factor position: `$a = and`, `$a and or $b`, bare `not`) is a strict parse error
`"'and' is a reserved word ..."` - deliberately NOT `DollarPrefixRequiredMsg`, so `validate` shows the real problem and
`parseProblem`/`compile` do not retry the legacy parser. Accepted legacy deviation (Planner Notes): legacy retry stays keyed
on the strict parser's FIRST error being `DollarPrefixRequiredMsg`, so a legacy expression changes only if the strict
parse now succeeds or stops on another error before reaching a non-reserved bare name: all-`true`/`false` bare words
(`true` -> literal, `true * 2` -> per-row type error/null) or a reserved word misused as a value first (`and + 1`,
`not`, `not + price`). Expressions reaching another bare name first (`price * and`, `true + price`, `True + price`)
still fall back and behave exactly as before. Each case pinned by a test.

**D2 Grammar (strict only).**
```
expr    -> orExpr
orExpr  -> andExpr ('or' andExpr)*
andExpr -> notExpr ('and' notExpr)*
notExpr -> 'not' notExpr | cmpExpr
cmpExpr -> sum (CMP sum)?          // non-associative: a second CMP is a parse error
sum     -> term (('+'|'-') term)*  // unchanged
term, unary, factor unchanged; factor adds 'true' | 'false'
```
`parseArgs` and parenthesised groups call `expr` (so `if($a > 1 and $b, ...)` works). The legacy parser is untouched.

**D3 AST.** Add `BoolLit(b)`, `Cmp(op: String, l, r)`, `And(l, r)`, `Or(l, r)`, `Not(e)`. `if` stays a `Call("if",
args)` registered in `SupportedFunctions` and `checkArity` (exactly 3), so the fixture/help/mcp seam covers it. Keep
`BinOp(Char)` for arithmetic. Every exhaustive match (`checkRefs`, `inferTypeOf`, `evalExpr`,
`ExpressionNumericContexts`, anything else the compiler flags) gets the new cases.

**D4 Values.** Every `Val` match site must handle `VBool` explicitly (Scala 2.13 here has no fatal warnings: a
missed site is a run-time `MatchError` that escapes `ComputeStep.apply` and fails the whole run). Sites:
`ExpressionInterpreter` (`evalExpr` FieldRef, `applyOp`, `Neg`, `applyFn`'s substring/lower/upper/length/round/mod,
`numericUnary`, `concatStr`, `typeName`, `valToJs`) and `ExpressionDateTimeFunctions.instantOf` (VBool -> not a
timestamp -> row `null`); the executor greps `VStr\|VNum\|VNull` across `domain/engine` and lists each site handled
in its report. String functions (`substring`/`lower`/`upper`/`length`) read a `VBool` text argument as
`"true"`/`"false"`, preserving today's results (`length($flag)` = 4). Add `VBool(b)`; `FieldRef` maps `JsBoolean` -> `VBool`; `valToJs(VBool)` -> `JsBoolean`; `typeName`
-> "boolean"; `concatStr(VBool)` -> "true"/"false"; `applyOp('+')` concatenates when either side is VStr or VBool
(VBool+VNum and VBool+VBool included) so `$flag + 1` still yields `"true1"`. `-`/`*`/`/`/unary `-` and numeric
functions reject VBool (TypeError), as they rejected VStr("true") before. `applyFn` null guard unchanged.

**D5 Evaluation.** `Cmp`: null either side -> VNull; VNum/VNum numeric (`==` on doubles); VStr/VStr `compareTo`;
VBool/VBool `=`/`!=` only; else TypeError. `And`/`Or`/`Not`: SQL 3VL with short-circuit (`and` skips right when
left is false; `or` skips right when left is true); a non-bool, non-null operand -> TypeError. `if`: dedicated lazy
arm in `evalExpr` before the generic `Call` arm (like `coalesce`): evaluate cond; true -> then; false/null -> else;
other -> TypeError; only the chosen branch is evaluated.

**D6 Inference.** Kinds: numeric {integer, float}, text {string, string-body, timestamp}, boolean; anything else
(binary-ref) is not comparable (inference error). `Cmp` -> "boolean" after the kind check (ordering on booleans is an
error); `And/Or/Not` -> "boolean" iff operands infer "boolean"; `BoolLit` -> "boolean"; `+` adds "boolean" to
`TextLike`; `if` -> condition must be "boolean", branches via a shared `commonType(fnName, types)` generalising
`coalesceType` (same -> that; all numeric -> float; no numeric and no boolean -> string; else error naming the
function; the numeric/text coalesce message keeps its `concat(...)` hint). Error messages name the operator/function
and the operand types; a numeric-vs-text comparison message ends with the fix: add a cast step to convert the text
field to a number, or, when the text side infers `timestamp`, compare instants with `seconds_between(a, b)`. All errors flow through `ColumnSchemaInference.inferCompute`'s existing `Left` arm.

**D6b Boolean used as a number.** A boolean-valued sub-expression that is not a bare field reference (`Cmp`, `And`,
`Or`, `Not`, `BoolLit`, or an `if`/`coalesce` inferring boolean) used as an operand of `-`/`*`/`/`/unary `-`, a
numeric-function argument or `add_days`'s day count is an inference error suggesting `if(cond, 1, 0)` (e.g. `($s = "Done") * 1`), since it
nulls every row. A bare boolean `$field` keeps today's numeric-op-on-text warning (no new error on old expressions).

**D7 Numeric-context warning.** `ExpressionNumericContexts`: no new numeric contexts (comparisons are type-checked by
D6, which already errors on number vs text). `textRefs` descends into `if`'s two branches (value-propagating, like
`coalesce`) but not its condition, nor into `Cmp/And/Or/Not`; update the stale `TextTypes` comment (a JsBoolean is
now `VBool`, still non-numeric).

**D8 Seam fixture.** Add `"if"` to `functions` and a new `"operators"` array (`=`, `!=`, `<`, `<=`, `>`, `>=`,
`and`, `or`, `not`) and `"literals"` (`true`, `false`) to `compute-expression-functions.json`. Backend: a new
`ExpressionEvaluator.SupportedOperators`/`BooleanLiterals` vector, asserted equal both directions, plus a probe that
each fixture operator actually parses. Frontend: `computeFunctionReference.ts` gains an `if` entry and an operator
reference rendered in the existing disclosure in `ComputeFunctionReference.tsx` (relabel summary/aria-label to
"Functions and operators"; DESIGN.md patterns, no new component); its test asserts names == fixture. helio-mcp
`COMPUTE_EXPRESSION_DOC` names `if`, every operator and the literals; its test asserts it, and the existing
`listed()` function-name regex span must count `if` and nothing else (keep `not(`-style operator prose out of it).

**D9 Docs.** `docs/compute-expression-grammar.md`: new Comparison/Boolean/Conditional sections, precedence table,
null table, type rules, inference bullets, remove the "no conditionals (HEL-1070)" limitation, note the Spark
divergence and the conditional-count recipe `sum` over `if($status = "Done", 1, 0)`; update the grammar summary
comment in `ExpressionEvaluator`.

## Risks / Trade-offs

- Behaviour change: `$flag` (boolean column) alone now outputs a JSON boolean instead of the string "true", and
  `coalesce($flag, "x")` becomes an analyze error. Both fix analyze/apply parity (inferType already said
  "boolean"); flagged in the PR. Existing `+`/`concat` results are unchanged.
- An all-boolean `coalesce(...)` used as a number moves from warning-only to a D6b validation error (which, like every
  inference error, clears `canRun`/`autoRunnable` in the analyze response); disclosed in the PR. `($s = "Done") + 1`
  concatenates to `"true1"` (typed string) - documented next to the `if(cond, 1, 0)` recipe.
- A bare `not` (or `not` at end of input) must get the reserved-word message via an explicit parser rule; D2's
  `notExpr` alone would give "Unexpected end of expression".
- `ExpressionNumericContexts.TextTypes` still lists boolean (correct: a boolean in a numeric context nulls the row).
- Timestamp text comparison is wrong across mixed formats; documented with the `seconds_between` recipe (owner Q5 A).
- Pre-existing `+` with a `binary-ref` field infers float; not touched (noted as follow-up candidate).

## Planner Notes

- Self-approved (legacy deviation, confirmed acceptable by design-gate round 2): only the narrow set in D1 changes; legacy `$`-less expressions predate the strict grammar and such column names are reserved words in every SQL
  dialect. Called out in the PR; pinned by tests.
- Self-approved: `==`/`<>` rejected with a hint; keywords case-insensitive; binary-ref not comparable; `if` is a
  `Call` (not a new node) so the existing function seam carries it; no `null` literal (coalesce covers fallbacks).
- No new op, no `allowedOps`, no Flyway, no API/schema change (ticket's checklist items do not apply - premise
  validation). StepCard surface = the compute editor's Functions disclosure.
- Tests (driver brief, binding): red first, analyze-vs-apply parity, mutation-proven precedence, `[hel1468-guard]`
  in sbt output, no inline FQNs, `sbt testFull` not `sbt test`.

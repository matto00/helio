## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `64e374bb7519262655370bc8c0e210dba930f251`. The change dir is untracked and no code has changed yet. Cold read of ticket.md, proposal.md, design.md, tasks.md, specs/compute-expression-language/spec.md, the live `domain/engine` Expression* sources and the base spec `openspec/specs/compute-expression-language/spec.md`.

### What I verified (with evidence)

- **Cwd guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/compute-conditional-boolean-logic/HEL-1070`.
- **Owner rulings** are not re-litigated. `events.jsonl` records `escalation.answered` with sub_answers all A and `answer_source: human`, and the round-1 REFUTE verdict follows it.

**Round-1 change requests, checked against live code:**

1. **CR1 (`Val` match sites): CLOSED.** I grepped `VStr|VNum|VNull` in `backend/src/main/scala`. Matches exist only in ExpressionInterpreter, ExpressionDateTimeFunctions, ExpressionNumericContexts (a comment) and ExpressionTypeInference (a comment). No `Val` consumer exists outside the engine.
   - The non-exhaustive matches without a wildcard are `concatStr` (Interpreter:173), `typeName` (:182), `valToJs` (:188) and `instantOf` (DateTime:35). All four are named in D4.
   - The other sites (`applyOp` `case _`, `Neg` `other`, the string functions, `round`/`mod`/`numericUnary`, `dateTrunc` `case _`, `addDays` `case other`) have wildcards and are named where behaviour must change.
   - The `coalesce` arm (`v != VNull`) and `applyFn`'s `args.contains(VNull)` are VBool-safe.
   - Task 4.2 tests all three date functions with a boolean argument via `ComputeStep.apply`, and D4 requires the executor to list every grep-found site.
2. **CR2 (string functions on booleans): CLOSED via option (a).** D4 says VBool reads as "true"/"false" in substring/lower/upper/length. The MODIFIED function-call requirement adds the rule and the scenario `length/upper/substring($flag)` = 4/"TRUE"/"t", and task 4.2 pins it. The live `substring` arm (`case (other,_,_) if !other.isInstanceOf[VStr]`, :100) and the lower/upper/length `case VStr(s)` arms are what must change, and the design names them.
3. **CR3 (keywords): (a) and (b) CLOSED; (c) re-opened as CR1 below.**
   - (a) `FnName` is emitted only when `(` immediately follows (Tokenizer:130). D1 treats a keyword `FnName` like the keyword `Ident`, and task 4.1 tests `and(`/`or(`/`not(`.
   - (b) A keyword in factor position gets a reserved-word message, not `DollarPrefixRequiredMsg`. Fallback keys strictly on that exact message (`isDollarPrefixError`, Parser:197; callers Evaluator:108/157/215), so the reserved-word error correctly skips the legacy retry. Pinned in 4.1.
   - (c) The legacy deviation is pinned, but the description of it is factually wrong. See CR1.
4. **CR4 (mutations): CLOSED.** M1-M8 are named with their red tests. I traced each one and each test does go red under its mutation:
   - M1: `a=true,b=false,c=false` gives false instead of true.
   - M2: `not` on a number gives a TypeError, so null instead of true.
   - M3: the parse-error test goes red.
   - M4/M5: `floor("x")` gives a Left, so null instead of false/true.
   - M6: division by zero gives null instead of 0.
   - M7 and M8: the null-condition and 3VL table tests go red.
5. **CR5 (stale requirements): (a)/(b)/(c) CLOSED.** The MODIFIED `+` and function-call requirements are present. I diffed scenario titles of the three MODIFIED requirements against the base spec: every base scenario is carried over verbatim and only new ones are added. One additional stale requirement was found; see CR2.
6. **CR6 (cast hint): CLOSED.** D6 says a numeric-vs-text comparison message ends with the cast fix, or `seconds_between` for timestamp, mirroring `AnalyzeSchemaWarnings.computeNumericWarnings` (:236-238). It is in the spec bullet and asserted in task 4.5.

**Other checks:**
- **Inference.** `ExpressionTypeInference` has a `case _ => Right("string")` fallthrough (:40). D6 routes `if` through `commonType` and replaces `coalesceType` (:47-53). `inferCompute` (ColumnSchemaInference:71-75) surfaces any `Left` as validationError while keeping the column, matching the "step still saves" scenarios.
- **Boolean values reach compute as JsBoolean.** `CastStep` boolean is `Try(str.toBoolean)` (CastStep:85), so a Scala Boolean becomes JsBoolean. `if($flag, ...)` on a cast column is therefore sound.
- **No client-side parser exists** in frontend or helio-mcp (grep), so new syntax only needs the fixture, help and description work in D8.
- **Fixture.** `shared-test-fixtures/compute-expression-functions.json` currently has only `functions`. Adding `operators`/`literals` keys is additive for the three readers.

**Self-approved legacy deviation.** It is acceptable to self-approve. The owner chose word keywords (Q2 A), and reserved words follow from that choice. The legacy bare-identifier path is frozen, and its DataType caller was retired (Evaluator:146-149). The deviation is narrow and test-pinned. Approving it does require the deviation to be described correctly, which it currently is not (CR1).

### Verdict: REFUTE

The six round-1 items are substantively closed. Two spec-level inaccuracies remain. Either would make the archived spec contradict the code, or would push the executor toward a design the plan did not choose.

### Change Requests

1. **The legacy deviation is misdescribed: it depends on token order, not on whether the expression "uses a reserved word".**
   - Legacy fallback fires only when the strict parser's FIRST error is `DollarPrefixRequiredMsg` (`parseProblem`/`compile`/`validateTolerant`, Evaluator:108/215/157). The strict parser stops at the first bare identifier it meets.
   - So under D1/D2 as written:
     - `price * and` and `price + true` fail strict on `price` (Dollar-prefix), fall back to legacy, and are **unchanged**.
     - `true + price` and `true * price` parse `true` as BoolLit, fail on `price` (Dollar-prefix), fall back to legacy, and are **unchanged** (`true` stays a column there).
     - Only these change: expressions whose first bare word reached is a reserved word in operand position (`and + 1`, `not`), and expressions with no other bare identifier (`true`, `true * 2`).
   - Yet design.md D1 says "any other legacy expression using a bare `and`/`or`/`not`/`true`/`false` column name (now a reserved-word parse error)". The ADDED spec requirement says "any other use is a parse error". Both are false for the mechanism the design specifies.
   - A test written from the spec text (`price * and` → error) would go red against a correct implementation. The executor could then "fix" it by changing the fallback condition or pre-scanning for keywords, which is an unplanned design change.
   - Required:
     - (a) In design.md D1/Planner Notes and the spec's "Boolean operators" requirement, state the actual rule. A legacy expression changes only if strict parsing either succeeds (its only bare words are `true`/`false`) or fails first on a reserved word. Otherwise it falls back to legacy exactly as before. Alternatively, deliberately choose uniform rejection and specify the mechanism; the order-dependent rule is preferred because it preserves more legacy behaviour.
     - (b) Add the unchanged cases to task 4.1's legacy pins, for example `price * and` and `true + price` evaluated against rows with those columns, so they keep their legacy result.
     - (c) Make ticket.md AC exception (ii) match.

2. **The base requirement "Column references require a `$` prefix" becomes stale and needs a MODIFIED delta.**
   - The base spec (`openspec/specs/compute-expression-language/spec.md` lines 10-16) says "A bare identifier not preceded by `$` and not immediately followed by `(` (a function call, see below) SHALL be a parse error."
   - After this change, `true`/`false` are bare identifiers that are not parse errors. `and`/`or`/`not` are accepted in operator position. `not(`/`and(` are immediately followed by `(` but are not function calls.
   - The change touches neither this requirement nor its scenarios, so the archived spec would contradict itself and the code (same class as round-1 CR5).
   - Required: add a MODIFIED "Column references require a `$` prefix" requirement (full text, all base scenarios kept). Carve out the reserved words (`and`, `or`, `not`, `true`, `false`, case-insensitive) from the bare-identifier rule and from the "followed by `(` is a function call" clause, cross-referencing the Boolean-operators requirement.

### Non-blocking notes

- **Silent all-null for boolean-valued sub-expressions in numeric positions.** Examples: `($status = "Done") * 1`, `floor($a > 1)`, `true * 2`, and `sum`-style intent written as arithmetic on a comparison.
  - `inferTypeOf` gives `float`, run time gives a TypeError and null on every row, and D7 deliberately does not descend into `Cmp/And/Or/Not`. So there is no analyze signal at all.
  - This is a plausible user mistake for exactly the ticket's use case (MySQL-style boolean arithmetic).
  - Options: make an arithmetic operand or numeric-function argument that infers `boolean` (and is not a bare FieldRef, which the existing warning covers) an inference error with an `if(cond, 1, 0)` hint, or extend the numeric-context warning. At minimum, document it in the grammar doc next to the conditional-count recipe.
- Keyword case-insensitivity means legacy columns named `True`/`NOT` are also reserved. Worth one pin in 4.1 and one word in the PR disclosure.
- Downstream handling of a `boolean`-typed compute output (e.g. aggregate `sum` over `$x > 1` rather than over `if(...)`) is untested. Consider one task-4.7 assertion that the documented recipe is the one that works, and that the boolean-column variant fails visibly rather than silently.

## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `64e374bb7519262655370bc8c0e210dba930f251` (change dir untracked; no code changes yet).

### What I verified (with evidence)

- **Cwd guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/compute-conditional-boolean-logic/HEL-1070`.
- **Owner rulings.** `.concertino/runs/HEL-1070/events.jsonl` line 8 records `escalation.answered`, `sub_answers ["A","A","A","A","A","A"]`, `answer_source: human`. `answer.json` matches. I checked the option text (`hel1070-subq.json`, `evidence/escalation-1-context.md`) against proposal and design. Q1-Q6 are carried over faithfully. Q6's "same as coalesce" correctly keeps coalesce's string/timestamp mixes resolving to `string` (D6 `commonType`).
- **Premise.** Read the live code and confirmed: the tokenizer has no comparison tokens (`ExpressionTokenizer.scala` Token ADT); the AST is `NumLit/StrLit/FieldRef/BinOp/Call/Neg`; `Val` is `VNum/VStr/VNull`; `JsBoolean` becomes `VStr(b.toString)` (`ExpressionInterpreter.scala:28`); inference has no boolean. The seam fixture lists functions only and is read by the three named tests. The 7 canonical field types are confirmed (`model.scala` `CanonicalWireValues`), and D6's kind table covers all 7. Source schema inference only types a column `boolean` from a real `JsBoolean` (`SchemaInferenceEngine.scala:219`), so CSV text never reaches compute typed as boolean. Values round-trip through the run path: `anyToJsValue` maps `Boolean` to `JsBoolean` and `jsValueToAny` maps it back.
- **Legacy interaction.** Only the strict parser's `DollarPrefixRequiredMsg` triggers the fallback (`parseProblem`, `compile`, `validateTolerant`). D1 keeps keywords as `Ident`/`FnName` tokens, so legacy token streams for valid legacy input do not change. New operator tokens only change the error text for input that was already invalid. Sound in principle, with the gaps in CR3.
- **Compiler as a safety net.** `backend/build.sbt` has no `scalacOptions` and no `-Werror`/fatal-warnings (Scala 2.13.15). A non-exhaustive `Val` match therefore compiles with only a warning and throws `MatchError` at run time. `ComputeStep.evaluate` is `Future.successful(ComputeStep.apply(...))`, so a throw inside `apply` fails the run instead of nulling the row. D3's "anything else the compiler flags" is not a gate.
- **Inference/apply parity** for each new construct (Cmp, And/Or/Not, BoolLit, `if`, `+` with boolean, coalesce with boolean, a bare `$flag`): the D4/D5/D6 rules give matching JSON types in every case I traced, apart from the gaps below.

### Verdict: REFUTE

The grammar design is sound and faithful to the rulings. However, D4 does not account for every consumer of `Val`. As written, the plan both crashes a run path and silently changes existing expressions, against the AC "Existing expressions ... keep their behaviour".

### Change Requests

1. **Run crash: `ExpressionDateTimeFunctions.instantOf` is a non-exhaustive `Val` match** (`ExpressionDateTimeFunctions.scala:35-39`: cases `VStr`/`VNum`/`VNull` only). After D4 adds `VBool`, any boolean timestamp argument throws `MatchError`, and that escapes `ComputeStep.apply`. Examples: `seconds_between($flag, $ts)`, `date_trunc("day", $a > 1)`, `add_days(true, 1)`. Today a boolean there yields `null`, and `ExpressionDateTimeFunctionsSpec.scala:65` pins `seconds_between` with `JsBoolean(true)` as `Right(JsNull)`. D4 must list `instantOf` explicitly: `VBool` gives `None`, so the row is null. Tasks need a test for each of the three date functions with a boolean argument. Because the build does not fail on warnings, D3/2.4 should replace "anything the compiler flags" with an explicit list of every `Val` match site: `concatStr`, `typeName`, `valToJs`, `applyOp`, `applyFn` string/numeric arms, `Neg`, `instantOf`, `addDays`. Alternatively, require the executor to show a compile log with zero new "match may not be exhaustive" warnings.

2. **Silent behaviour change: string functions on boolean columns.** `lower`/`upper`/`length` match `case VStr(s)` with an erroring `case other`, and `substring` requires `VStr`. Today `length($flag)` is `4`, `upper($flag)` is `"TRUE"` and `substring($flag,0,1)` is `"t"`. Under D4 each becomes a TypeError, so the row is null for every row. Analyze gives no signal: inference still says `float`/`string`, and the `pipeline-analyze-schema-warnings` spec (line 122) explicitly says a field "used with ... a string function SHALL NOT warn". The design's Risks section claims only `+`/`concat` are unchanged and says nothing about these four. Two acceptable fixes:
   - (a) Recommended. Treat `VBool` as its text `"true"`/`"false"` in `lower`/`upper`/`length`/`substring`'s string argument, like `concatStr`. Add a spec scenario and a test that existing results are preserved.
   - (b) Rule that it is an accepted change, list it in Risks and the PR, and add an analyze-time error or warning so it is not silent.

   Either way, add tasks and tests. Q3-A only covered booleans being booleans and `+` still concatenating; it did not cover string functions.

3. **Keyword handling in the strict parser is underspecified, in three ways:**
   - (a) D1 only handles `not(` arriving as `FnName`. `$a and($b or $c)` and `$a or(...)` tokenize as `FnName("and")`/`FnName("or")` (`ExpressionTokenizer.scala` letter arm: an identifier immediately followed by `(` becomes `FnName`). The `and`/`or` loops must accept those too, or the input is a confusing parse error. Add parser tests for `and(`, `or(` and `not(`.
   - (b) Specify the error for a keyword in operand position, such as `$a = and`, `$a and or $b` or `$a = not $b`. If the factor arm's existing `Ident` branch returns `DollarPrefixRequiredMsg`, the strict `validate` shows a misleading "require a '$' prefix" message, and `parseProblem`/`compile` silently retry the legacy parser. Choose a keyword-specific message, or deliberately keep the fallback, and pin it with a test.
   - (c) Enumerate the exact legacy inputs whose behaviour changes and pin each one in 4.1. Examples: a legacy expression that is exactly `true`/`false` (was a column ref, now a literal), `true * 2`, `not` alone. D1 calls this "vanishingly rare", but the ticket AC says legacy expressions keep their behaviour. A deviation from an AC must be explicit and test-pinned, not a one-line aside.

4. **Mutation plan is unnamed.** C5 says "each named mutation in 4.3 is applied", but 4.3 names expressions, not mutations, so there is no acceptance signal for the AC "precedence is mutation-proven". Name the mutations in tasks.md, at minimum:
   - swap the `or`/`and` precedence levels;
   - parse `not` below comparison (`not` binds to `$a`, not `$a = $b`);
   - make comparison associative (accept `1 < $x < 5`);
   - drop the short-circuit in `and` and in `or`;
   - evaluate both `if` branches eagerly;
   - send a null `if` condition to the then-branch;
   - make `null and false` return null.

   For each, name the test expected to go red.

5. **Spec delta misses requirements that become stale.**
   - (a) "Numeric operators are type-strict; `+` is coercion-permissive" says `+` concatenates "if either operand is a string". It needs a MODIFIED delta adding booleans (D4: `VBool + VNum` concatenates). Otherwise the archived spec contradicts the code.
   - (b) "Function-call syntax for string operations" enumerates "a fixed set of functions" and does not list `if`. Add `if` (arity 3) via MODIFIED, or explicitly cross-reference the new requirement.
   - (c) If CR2 is resolved by (a), the string-function requirement or its scenarios must state the boolean-as-text rule.

6. **Comparison type-mismatch message must carry the cast hint the owner was shown.** `evidence/escalation-1-context.md` Q5 told the owner: "Uncast CSV numbers: cast first (numeric-op-on-text warning extended)". D7 instead adds no warning and relies on D6's analyze error, which is fine. But D6's message spec only "names the operator and the operand types". CSV columns are strings (no CSV boolean/number inference), so `$amount > 100` on an uncast CSV column will be the most common failure. D6 must require a number-vs-text comparison error to suggest adding a cast step, mirroring `computeNumericWarnings`, so the owner-facing promise is kept. Add the assertion to 4.5.

### Non-blocking notes

- D7: consider letting `textRefs` descend into `if`'s two branches as a value-propagating position, the same as `coalesce`. Then `floor(if($ok, $s, $t))` still names `s`/`t` in the numeric-op-on-text warning. The `TextTypes` comment ("`JsBoolean` evaluates as a string too") becomes stale and should be updated.
- The Functions disclosure lives in `ComputeFunctionReference.tsx` (summary "Functions", `aria-label="Expression functions"`), not `ComputeFieldConfig.tsx`. Once operators are listed, consider relabelling to "Functions and operators" and updating the aria-label and the test.
- The spec says "UTF-16 code unit", while the escalation context said "code point". Scala `compareTo` is UTF-16, so the spec matches the code; the difference only affects surrogate pairs. Fine as is.
- helio-mcp's `listed()` regex picks up any `name(` between "Functions: " and " date_trunc/add_days return". Keep operator prose such as `not(` out of that span, or extend the test, so `if` is counted and nothing else is.
- Spark `F.expr` divergence is correctly scoped out. Spark SQL has `if`/`and`/`=` with similar semantics, so the doc note can say what differs (null handling, typing) rather than only "not supported".

## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 400fca29dba0953329e277f6911d8011bff85c0f (origin/main; the change dir is untracked planning output).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/compute-unary-minus-string-warnings/HEL-1403`.

### What I verified (with evidence)

**Parser / AST ground truth (`ExpressionParser.scala`)**
- `StrictParser` is `expr → term (+|- term)*`, `term → factor (*|/ factor)*`. `parseFactor` has no `Minus` arm, so a
  leading `-` falls to `case other => Left("Unexpected token in expression: Minus")`. Matches design Context.
- `ExpressionTokenizer.scala:38` emits `Token.Minus` for every `-`. Numbers carry no sign and there is no exponent
  syntax, so the D1 alternative (a) rejection holds.
- AST is `NumLit | StrLit | FieldRef | BinOp | Call`, sealed. I grepped `backend/src` for every AST match: exactly three sites:
  `ExpressionEvaluator.checkRefs` (l.153-163), `ExpressionTypeInference.inferTypeOf`, and `ExpressionInterpreter.evalExpr`.
  Nothing in `src/test` matches on the AST. Task 2.2's enumeration is complete. Note: `backend/build.sbt` has no
  `-Xfatal-warnings`, so a missed match is only a compiler warning. Task 2.2 handles this by requiring no
  non-exhaustive-match warning, which is adequate.

**D1 binding**
- `unary → '-' unary | factor` under `term`. Function args and parens go through `parseExpr`, so `mod(-7, 3)`,
  `round($x, -2)` and `(-$x)` need no extra rule. That is correct.
- Binding tighter than `*`/`/` cannot change a value (`(-a)*b == -(a*b)`, same for `/`), and there is no power operator.
  The decision is safe. `--x` is unambiguous here because the tokenizer has no comment syntax.

**D2 parity**
- `numericUnary` uses `+ 0.0` to avoid -0.0, and D2 mirrors it.
- Null propagates the same way `applyOp`'s null guard does.
- Inferring `float` matches binary `-` (`ExpressionTypeInference` l.15-22 returns "float" for any non-`+` op), and the
  `Left` from coalesce or an unknown field propagates. Sound.

**D3 legacy unchanged**
- I traced `-price`. Before the change, strict fails with "Unexpected token…: Minus", which is not the `$` message, so
  there is no legacy retry. After the change, strict reaches `Ident`, returns the `$`-prefix error, retries legacy, and
  legacy fails with the same "Unexpected token in expression: Minus".
- The outcome is unchanged: still a parse error, so `compile`/`evaluate`/`parseProblem` still return Left.
- The set of expressions routed to legacy grows only by expressions that contain a factor-position `-`, and the frozen
  legacy parser rejects all of those. No previously-valid expression changes behaviour. The claim holds.

**D4 Spark**
- `SparkJobSubmitter.scala:246` is `df.withColumn(col, F.expr(expression))`. That is a pass-through, as the design says.
- Spark SQL's lexer treats `--` as a line comment, so the documented divergence is real. `$` refs already diverge there
  (existing Known-limitations note in `docs/compute-expression-grammar.md`).

**D5 warning and non-blocking claim**
- `AnalyzeSchemaWarnings.compute` is a separate pure pass. Its only consumers are `PipelineService.scala:1010` (full),
  `:1149` (concise, `groupMap` into `ConciseAnalyzeNode.warnings`) and `:1471` (proposal).
- Each one feeds only `warnings`. None feeds `validationError`, `costVerdict` (`costInputGathering`/
  `PipelineCostEstimator` take `enabledSteps`, not warnings), `stepConfigProblem` or auto-run.
- `ColumnSchemaInference.inferCompute` (l.48-75) is untouched by D5. AC5 non-blocking holds by construction.
- Trust model:
  - `inputFlags` treats the root as `Flags(nonEmpty, nonEmpty)` (l.85-89).
  - `compute`/`fillnull`/`aggregate` are absent from `typeTrusted` (l.58-59).
  - `castRuntimeTargets` (l.64) excludes `float`/`timestamp`, which confirms the HEL-1436 note: silent there, never wrong.
- `family` pins `boolean` (l.73). `ExpressionInterpreter` maps `JsBoolean` to `VStr`, so `-`/`*`/`/`/numeric functions on
  a boolean are a per-row TypeError. Including boolean is justified.
- CSV all-string: `SchemaInferenceEngine.fromCsvLines` (l.54-58, HEL-893 D1) says every cell materialises as `String`,
  and a blank cell is null. Confirmed.
- Ordering: the existing sort is `(pos, stepId, code, message)`. The message starts `compute: field '<f>'`, so it sorts
  by field name per the spec.
- Gating on `validationError.isEmpty` excludes legacy/bare-identifier and coalesce-mixed expressions. Strict parsing is
  therefore guaranteed whenever the helper runs.

**Contract surfaces (AC6)**
- I grepped for an existing code (`join-column-renamed`). The only hits are:
  - `AnalyzeSchemaWarnings.scala`
  - `PipelineAnalyzeProtocol.scala`
  - both `schemas/pipelines/*analyze*-response.schema.json`
  - `frontend/.../pipelineStep.ts:631`
  - `helio-mcp/src/{types.ts, tools/read.ts, tools/pipelineProposal.ts}`
  - `helio-mcp/src/server.test.ts:262` (description pin)
  - specs
- Task 5.1 covers every one. There are no yaml/OpenAPI hits, and no frontend consumer switches on `AnalyzeWarningCode`.

**AC coverage**
- AC1: D1/D2 and tasks 1.1, 2.1-2.3.
- AC2: D3 and its test in 1.1.
- AC3: 1.1 (unit) and 1.2 (real run that persists `node_snapshots`).
- AC4: D4 and 2.3.
- AC5: D5, 3.1-4.3.
- AC6: D6 and 5.1.
- I found no scope drift. The non-goals are explicit.

### Verdict: REFUTE

One real contract gap. Everything else is sound.

### Change Requests

1. **Missing spec delta: the canonical spec will keep a now-false claim after archive.**
   - `openspec/specs/compute-expression-language/spec.md:260` (Requirement "Numeric functions have defined rounding,
     sign, and null semantics", Scenario "round with negative digits") reads:
     ``- **WHEN** `round($x, 0 - 2)` (the grammar has no unary minus) is evaluated…``
   - The change's spec delta only ADDs a requirement. It does not modify this one, so archiving syncs a spec that
     contradicts the new "Unary minus negates a numeric operand" requirement.
   - Required fix: add a `## MODIFIED Requirements` block to
     `specs/compute-expression-language/spec.md` carrying the full text of that requirement. In it:
     - Rewrite the scenario as `round($x, -2)` and drop the parenthetical.
     - Optionally rewrite `mod($a, 0 - 3)` (l.268) as `mod($a, -3)`.
   - Also widen task 2.3's grep check ("no doc text still claims there is no unary minus") to include `openspec/specs/`
     and `backend/src/main`, not only `docs/`. I confirmed l.260 is the only stale spec site today.

### Non-blocking notes

- **Trust-gate false negative is coarser than the spec scenario suggests.** Compute is single-column (`ComputeConfig`),
  but its whole output is untrusted.
  - Example: CSV root → `compute full = $first + $last` → `compute p = floor($price)` gets NO warning for `price`, even
    though `price` passed through untouched as a string.
  - The design does disclose "missed warnings after such steps", and the spec text says "after a compute" generally.
    Still, the scenario chosen ("a compute that produced `x`") hides the common case.
  - Suggestion: pin the CSV→compute→compute(untouched column) behaviour in a test so it is a known, documented gap.
    Consider a follow-up for per-column trust through compute, since only `column` changes.
- **Mutation check 4.3 needs a text-typed fixture.** The "after a compute that produced the field" fixture must give the
  produced field a projected text type (e.g. `x = $s` or `$s + "a"` infers `string`). Otherwise dropping the trust gate
  will not turn it red, and the mutation proof would be vacuous.
- **"Never a false positive" (design Risks) is slightly overstated.** Root types are trusted (same HEL-1235 model), so a
  stale or row-0-inferred JSON/REST root schema that says `string` while run-time values are numbers would produce a
  wrong "every non-null row will compute null" message. The message does state the evidence base ("in this step's
  inferred input schema"), which is the HEL-1235 rule, so this is acceptable. Better to word Risks as "no false
  positive beyond HEL-1235's root-trust assumption".
- `AnalyzeSchemaWarnings.scala` has stale doc comments once compute warns:
  - The header comment (l.12-17, "Three silent-wrong-result shapes…").
  - The l.30-32 note listing `compute` among ops "never double-reported".
  - The canonical `pipeline-analyze-schema-warnings` Purpose line lists three findings.

  Worth refreshing in the same change.
- D2's TypeError wording "Operator '-' cannot be applied to string" is fine. The parity table asserts value parity with
  `0 - e`, not message parity, which is correct.

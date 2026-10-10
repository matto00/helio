## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 400fca29dba0953329e277f6911d8011bff85c0f (origin/main; the change dir is untracked planning output).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/compute-unary-minus-string-warnings/HEL-1403`.

### What I verified (with evidence)

**Round-1 required revision**
- I extracted the main spec's "Numeric functions have defined rounding, sign, and null semantics" block
  (`openspec/specs/compute-expression-language/spec.md`) and diffed it against the change's MODIFIED delta.
- There are exactly two differences:
  - l.260: `round($x, 0 - 2)` (the grammar has no unary minus) becomes `round($x, -2)`.
  - l.268: `mod($a, 0 - 3)` becomes `mod($a, -3)`.
- The requirement header and every other scenario are verbatim, so archiving cannot drop a scenario. **Resolved.**
- Task 2.3's grep now covers `docs/`, `openspec/specs/`, `backend/src/main` and `helio-mcp/src`.
  - I ran the equivalent grep. The only hits are `docs/compute-expression-grammar.md` l.92/93/95/96/109/176, plus the
    two spec lines above.
  - Task 2.3 rewrites all of the doc hits, and the delta handles the spec lines. Nothing is missed.

**Other round-1 notes folded in**
- C1 (text-typed mutation fixture) is in tasks.md and workflow-state CONSTRAINTS.
- Task 3.1 uses the `x = $s` fixture and has the CSV→compute(unrelated)→`floor($price)` granularity pin.
- The Risks wording is now "minimised, not eliminated".
- Task 4.1a covers the stale header comment in `AnalyzeSchemaWarnings.scala` (l.12-17, l.30-32).
- The Purpose-line note is in Risks.

**The second MODIFIED delta (`pipeline-analyze-schema-warnings`)**
- It is the whole "Analyze responses carry schema-only warnings" requirement with only the code list extended.
- Both scenarios are carried. I compared it against main spec l.8-17.

**Parser ground truth (`ExpressionParser.scala`)**
- The structure matches design Context. D1's `term → unary (...)`, `unary → '-' unary | factor` is a minimal,
  correct change.
- Function args and parens re-enter `parseExpr`, so `mod(-7, 3)` / `round($x, -2)` / `(-$x)` need no extra rule.
- The tokenizer has no comment syntax, so `--x` is unambiguous.
- The AST is sealed. The match sites are `checkRefs` (ExpressionEvaluator l.154), `inferTypeOf` and `evalExpr`.
  Task 2.2 enumerates them by grep.

**D3 (legacy) re-traced**
- Before the change, `-price` fails strict with `Unexpected token in expression: Minus`, which is not the `$` message,
  so there is no legacy retry.
- After the change, strict reaches `Ident` and returns the `$`-prefix error. That triggers the legacy retry, and the
  frozen legacy parser fails on `Minus` with the identical message.
- So `compile`/`evaluate`/`parseProblem`/`validateTolerant` return the same Left text as before. No previously-valid
  expression changes behaviour, because legacy rejects every factor-position `-`.
- There is one subtle message change (see non-blocking note 3).

**D2 parity**
- `applyOp` null-guards first. Binary `-` on a non-number is a TypeError.
- `numericUnary` uses `+ 0.0`.
- `inferTypeOf` returns `"float"` for every non-`+` BinOp.
- D2 mirrors all of the above. The parity table (`-e` ≡ `0 - e`) is a sound red-first oracle.

**D4 (Spark)**
- Spark is a pass-through (`F.expr`), `$` refs already diverge there, and the `--` comment divergence is real. It is
  documented, and AC4 allows a documented difference.

**D5 (warning) checked against `AnalyzeSchemaWarnings.scala`**
- Root inputs are `Flags(nonEmpty, nonEmpty)` (l.88). `compute`/`fillnull`/`aggregate` are absent from `typeTrusted`
  (l.58-59). `castRuntimeTargets` (l.64) excludes `float`/`timestamp`, so the HEL-1436 note holds.
- Including `boolean` is justified: `ExpressionInterpreter` l.27 maps `JsBoolean` to `VStr`.
- `+` with a string is concatenation (interpreter l.63-65), so `floor($s + 1)` really does null every row and the
  warning is truthful.
- The step loop (l.127) already filters on `step.enabled && validationError.isEmpty`. That guarantees a strict parse
  for every expression the helper sees (legacy and coalesce-mixed expressions carry a `validationError`).
- Sorting is `(pos, stepId, code, message)` and the message starts `compute: field '<f>'`. That satisfies the spec's
  per-field ordering.
- `ComputeConfig(column, expression, type)` exposes the `expression` that D5 decodes.

**Non-blocking (AC5)**
- `AnalyzeSchemaWarnings.compute` has exactly three consumers: `PipelineService.scala` l.1010, l.1149 and l.1471.
- All three feed only `warnings`.
- D5 does not touch `ColumnSchemaInference.inferCompute`. Task 4.2 re-proves this by grep.

**Contract surfaces (AC6)**
- I grepped the repo for `join-key-type-mismatch`, excluding archive. Every hit is either in task 5.1's list or is a
  test or spec: the backend object, the protocol doc comment, both analyze schemas, `pipelineStep.ts`, helio-mcp
  `types.ts`/`read.ts`/`pipelineProposal.ts`/`server.test.ts`, and the main spec plus delta.
- No frontend expression parser exists. `ComputeFieldConfig.tsx` only renders the server's `validationError`, so no
  client grammar needs updating.
- The schema-validation test pattern exists in `PipelineAnalyze{,Proposal,CanRun}RoutesSpec.scala`.

**AC trace**
- AC1: D1/D2, tasks 1.1 and 2.1-2.3.
- AC2: D3 and its test in 1.1.
- AC3: 1.1 (unit) and 1.2 (real run that persists `node_snapshots`).
- AC4: D4 and 2.3.
- AC5: D5, 3.1-4.3.
- AC6: D6 and 5.1.
- There is no scope drift, and the non-goals are explicit. I found no placeholders, TBDs or internal contradictions.

### Verdict: CONFIRM

### Non-blocking notes

1. **D5's "collect the operand's FieldRefs" is ambiguous about nested function arguments.** Take
   `floor($s + length($t))`:
   - The operand infers `string` because of `$s`, so the literal reading also collects `t`.
   - But `t` is consumed legitimately by `length`, and casting it would not help, so a warning naming `t` + `floor` is
     misleading.
   - Suggested rule for the executor: when the operand is non-numeric, descend only through value-propagating
     positions (`+` operands, `coalesce` args, `Neg`, parens), not into `length`/`concat`/`substring`/`lower`/`upper`
     arguments.
   - Pin this with one test (`floor($s + length($t))` warns on `s` only).
2. **Known false negative to note in the PR, not fix here.** `inferTypeOf` gives `+` the type `"float"` unless an
   operand's type is literally `"string"`. So `floor($b + 1)` (b `boolean`) or `floor($sb + 1)` (`string-body`) infers
   numeric and stays silent, even though it nulls every row at run time. The warning is silent there, never wrong.
3. **D3 says "fails exactly as before". That is true of `evaluate`/`compile`/`parseProblem`, but not of strict
   `validate`.**
   - `validate("-price")` will now return `Column references require a '$' prefix` instead of
     `Unexpected token in expression: Minus`. That is arguably a better message, but it is a change.
   - The D3 test in 1.1 should pin the run-path behaviour (`evaluate` → ParseError with the unchanged message,
     `parseProblem` unchanged).
   - It should either assert the new `validate` message or not assert the old one, so the executor doesn't "fix" a
     correct implementation to satisfy an over-literal test.

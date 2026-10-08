## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `9e502165bb901d4ac83f3a22a201cce453178a16`. The diff base was resolved live with
`resolve-review-base.sh` (main/origin) as `8efa42298fdf19779174beba6a35ead4c2d7126b`. The change is backend and docs
only, so the UI step (4) does not apply. No servers were started, the browser was not used, and no dev-DB residue was
left.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/compute-numeric-functions/HEL-1315`.
- **Diff read in full:** `git diff $BASE...HEAD -- backend docs`. It touches `ExpressionEvaluator.scala` (+61),
  three specs, and `docs/compute-expression-grammar.md`.
- **Gates, run fresh:** `nice -n 19 sbt "testOnly ExpressionEvaluatorSpec PipelineAnalyzeServiceSpec ComputeStepSpec"`
  ran 243 tests: 243 succeeded, 0 failed, EXIT=0. All HEL-1315 test names appear in the output. The evaluator's pasted
  `sbt testFull` result (6205 succeeded, 0 failed, EXIT=0) is concrete and unambiguous, so I accepted it.
- **Independent probe (`sbt Test/console`, a probe script outside the worktree):**
  - **AC1, values including negatives:**
    - `floor(-2.5)=-3`, `ceil(-2.5)=-2`, `abs(-2.5)=2.5`, `round(-2.5)=-3`.
    - `mod(-7,3)=2`, `mod(-7,0-3)=-1`, `mod(0-7,0-3)=-1`.
    - `round($rate*100,1)` with rate 0.8734 gives 87.3.
    - `round(1.5, 0-1000000000)=0` (clamped, no blow-up).
  - **AC1, null and bad input:** `floor($z)`, `round($z,2)` and `mod($n,$z)` all return null. `floor("3.7")` is a
    `TypeError`, so the row value is null. `mod($n,0)` is `DivisionByZero`, so the row value is null.
  - **No `-0` in output:** `concat(floor(..),"")` renders `"-3"`, and the `-0` candidates (`mod(0-6,3)`,
    `round(0-0.4)`) render `"0"`.
  - **AC2, infer/apply parity:** `inferType` returns `float` for floor/round/mod/abs, and evaluation returns a JSON
    number. `ceil($missing)` gives `Left(Unknown field)`. The spec checks the same thing at
    `ExpressionEvaluatorSpec` "infer/apply parity", which also requires `NumericFunctions` to equal
    `SupportedFunctions` minus the string functions. Analyze-level coverage is in `PipelineAnalyzeServiceSpec`
    (`SchemaField("r","float")`, `validationError None`).
  - **AC3, unknown-function message:** `validate("sqrt($x)")` returns
    `'sqrt' is not a recognized function; supported functions: abs, ceil, concat, floor, length, lower, mod, round, substring, upper`.
    The analyze `validationError` and the write path `validateRawConfig` carry the same message, per the
    `PipelineAnalyzeServiceSpec` and `ComputeStepSpec` tests.
- **Standing constraints:**
  - C1: no test claims to guard `-0.0`.
  - C2: no `0 <= mod < b` assertion; only exact cases are tested.
  - C3: the drift guard runs in both directions, list to dispatcher and dispatcher to a 47-name candidate probe. The
    evaluator mutation-checked it.
  - C4: `BigDecimal.RoundingMode.HALF_UP` (Scala).
- **Other function-list sites:** grepped `frontend/src`, `helio-mcp/src` and `backend/src/main`. The only other list
  is the evaluator's own header. `ComputeFieldConfig.tsx` has only a placeholder and no function list.
- **Do the grammar-doc examples parse?** The grammar has no unary minus: `parseFactor` has no `Token.Minus` case, and
  the doc's own line 159 says so. Probe output:

  ```
  validate floor(-2.5)        => Left(Unexpected token in expression: Minus)
  validate ceil(-2.5)         => Left(Unexpected token in expression: Minus)
  validate round(-2.5)        => Left(Unexpected token in expression: Minus)
  validate mod(-7, 3)         => Left(Unexpected token in expression: Minus)
  validate mod(7, -3)         => Left(Unexpected token in expression: Minus)
  validate round(1234, 0 - 2) => Right(())
  validate round(2.675, 2) / mod(7, 3) / mod(5.5, 2) / round($rate * 100, 1) / mod($n, 3) => Right(())
  ```

### Verdict: REFUTE

All three ACs are met and the code is correct. The REFUTE is for the documentation only.
`docs/compute-expression-grammar.md` is the grammar contract, and five of its new code-formatted function-call
examples are expressions the grammar rejects. A user who copies `mod(7, -3)` or `floor(-2.5)` from the table into a
compute step gets `Unexpected token in expression: Minus`. The same table cell already uses the parseable `0 - 2`
form for `round(1234, 0 - 2)`, which shows the inconsistency is an oversight, not a chosen notation. The spec delta
avoids the problem by using `$a`-with-row-values and `0 - 3`.

### Change Requests

1. `docs/compute-expression-grammar.md:92` (`floor`), `:93` (`ceil`), `:95` (`round(-2.5)`) and `:96`
   (`mod(-7, 3)`, `mod(7, -3)`): rewrite each negative-literal call in a form the grammar accepts. Either use
   `0 - x`, for example `floor(0 - 2.5)` = `-3` and `mod(7, 0 - 3)` = `-2`, or use a field with the value stated, for
   example "`floor($x)` = `-3` for `x = -2.5`", matching the spec delta's style.
2. `docs/compute-expression-grammar.md:108`: the examples-block comment `// bucket index; mod(-7, 3) = 2` has the
   same problem. Use `mod(0 - 7, 3) = 2`, or "`= 2` when `n = -7`".
3. Acceptance check: every code-formatted call in the new table rows and in the examples block must return
   `Right(())` from `ExpressionEvaluator.validate`. The evaluator should re-probe these, not just read them.

### Non-blocking notes

- `inferTypeOf` lists the numeric names inline instead of reading `NumericFunctions`. The spec guard catches drift,
  so this is optional (the evaluator noted it too).
- `round` on a non-finite `x` passes it through, and spray-json then serialises that as null. That is consistent
  with the pre-existing `*` overflow behaviour.

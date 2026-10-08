## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `c57beef2865049d35b3a63b255e4020d65757ee1`. The diff base was resolved live with `resolve-review-base.sh`
(main/origin) as `8efa42298fdf19779174beba6a35ead4c2d7126b`. The change is backend and docs only, so the UI step (4)
does not apply. No servers were started, the browser was not used, and no dev-DB residue was left.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/compute-numeric-functions/HEL-1315`.
- **Round-2 delta, read in full (`git show c57beef28`):**
  - `docs/compute-expression-grammar.md`: every negative-literal call is now written with `0 - x`:
    - the table rows for floor, ceil, round and mod
    - the examples-block comment `mod(0 - 7, 3) = 2`
  - `ExpressionEvaluator.scala:498`: `inferTypeOf` now uses
    `case n if n == "length" || NumericFunctions.contains(n) => "float"`. This is equivalent to the old inline list
    because `NumericFunctions` is `abs, ceil, floor, mod, round`. The spec's parity test pins
    `NumericFunctions == SupportedFunctions -- stringFns`, so dropping a name from the list now breaks production
    inference and also fails that test.
- **No unary minus left:** grepping the grammar doc and the spec delta for `floor(-`, `ceil(-`, `round(-`, `mod(-` and
  `, -<digit>` finds 0 hits.
- **Gates, run fresh at c57beef28:** `cd backend && nice -n 19 sbt testFull` gave
  `Suites: completed 443, aborted 0` / `Tests: succeeded 6205, failed 0, canceled 4` / `All tests passed.` /
  EXIT=0. The log contains the HEL-1315 tests, for example `round with 0.0 digits is accepted as a whole number`,
  `infer/apply parity: every numeric function infers float and evaluates to a JsNumber` and
  `ExpressionEvaluator.SupportedFunctions`, so they actually ran against the new main code.
- **C5, independent probe:** I ran `sbt Test/console` with a probe script outside the worktree. Every code-formatted
  expression in the new doc rows, the examples block and the spec-delta scenarios returns `validate => Right(())`
  and the documented value:
  - `floor(0 - 2.5)`=-3, `ceil(0 - 2.5)`=-2, `round(2.5)`=3, `round(0 - 2.5)`=-3
  - `round(2.675, 2)`=2.68, `round(1234, 0 - 2)`=1200
  - `mod(7, 3)`=1, `mod(0 - 7, 3)`=2, `mod(7, 0 - 3)`=-2, `mod(5.5, 2)`=1.5
  - `round($rate * 100, 1)`=87.3 with rate 0.8734, and `mod($n, 3)`=2 with n=-7
  - spec scenarios:
    - `floor($x)`/`ceil($x)` with -2.5 give -3/-2, and `abs($x)` with -4.25 gives 4.25
    - `round($x)` with ±2.5 gives ±3, `round($x, 2)` with 2.675 gives 2.68, and `round($x, 0 - 2)` with 1234
      gives 1200
    - `round($x, 1.5)` is a TypeError
    - `mod($a, 3)` with -7 gives 2, `mod($a, 0 - 3)` with 7 gives -2, and `mod($a, 0)` is DivisionByZero
    - null input gives null for floor, round and mod, and `floor($x)` with "3.7" is a TypeError
  - arity errors: `mod($a)` gives `mod requires 2 arguments`, and `round($a, 1, 2)` gives
    `round requires 1 or 2 arguments`
- **AC1 (values incl. negatives and null):** met. See the probe above. Also, `concat(floor($x),"")` with -0.4 gives
  "-1", and the `-0` candidates `round(-0.4)` and `mod(-6,3)` render "0".
- **AC2 (inferred = applied):** met. `inferType` returns `float` for floor, ceil, abs, round(1|2 args), mod and
  `round($rate * 100, 1)`, and evaluation returns a JSON number. `ceil($missing)` gives
  `Left(Unknown field: missing)`.
- **AC3 (message lists the new functions):** met. `validate("reverse($name)")` gives
  `'reverse' is not a recognized function; supported functions: abs, ceil, concat, floor, length, lower, mod, round, substring, upper`.
- **C1–C4:** unchanged since round 1, which verified them; the round-2 delta does not touch them. C1: no `-0.0` test.
  C2: no `0 <= mod < b` claim. C3: the bidirectional drift guard is still present. C4: Scala
  `BigDecimal.RoundingMode.HALF_UP`.

### Verdict: CONFIRM

Round 1's change requests 1–3 are resolved, which I checked by probing, not by reading. The main-code refactor
preserves behaviour and passed under a fresh full suite run.

### Non-blocking notes

- `inferTypeOf` infers `float` for `floor($s)` when `s` is a string, while evaluation gives a TypeError, so the row
  value is null. This matches the pre-existing `-`/`*` inference and the documented strict semantics, so it is not a
  parity defect.
- `ExpressionEvaluator.scala` is now about 724 lines. The evaluator's note to mention a split in the PR still stands.

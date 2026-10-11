## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `938c31a792712d550867fa4a6d5dfffdf5294959`. Diff base `64e374bb7519262655370bc8c0e210dba930f251` (resolved live via `resolve-review-base.sh`, exit 0).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/compute-conditional-boolean-logic/HEL-1070`.

### What I verified (with evidence)

**The ticket's ask works end to end in the running app (6502/9409, `assert-phase.sh servers` PASS).**
I used a throwaway user (`hel1070-skeptic-final@example.test`). I uploaded a real CSV (team,status,points,late; 5 rows, one blank status) and built ONE pipeline through the API: compute `is_done = if($status = "Done", 1, 0)` → aggregate `sum(is_done) AS done, count(team) AS total` → compute `pct = $done / $total * 100`.
- `GET /analyze`: `is_done` is `float`, `done` is `float`, `total` is `integer`, `pct` is `float`, and every `validationError` is None.
- `POST /run?dry=true`: `rows: [{"done":2.0,"total":5,"pct":40.0}]`. That is correct, because the blank-status row takes the else branch.

So the stale-% shape the ticket was filed for is now one live pipeline, with no join.
I also checked the real CSV loader. It infers every column as `string` and yields string cells. This means `$points > 2` on a raw CSV is an honest analyze error (cast hint), not a silent all-null comparison. Parity holds on the most common real source.
Cleanup: deleted by exact id+email via `e2e/support/userCleanupCore.cjs` `buildUserDeleteSql`. The post-check `users|pipelines|data_sources` count is `0|0|0`.

**Analyze-vs-apply parity on constructs the specs did not enumerate.** I wrote a scratch probe spec in a throwaway detached worktree at 938c31a79 (since removed). It covers 34 extra well-typed expressions × 3 rows (values / all-null / edge values). Examples: `if($flag, true, $other)`, `coalesce($n > 1, false)`, `if(not $flag, -$n, abs($f))`, `if($flag, date_trunc("day", $ts), $ts)`, `length($s) > 3`, `seconds_between($ts,$ts) >= 0`, `$flag = ($n > 1)`, `- if($flag,1,0)`, `round(if($flag,$f,0),1)`, `TRUE AND NOT FALSE`, `$s + ($n > 1)`, nested `if`, and `if($flag,$n,0) = 3`.
- Every one validated and inferred a type.
- Every non-null applied value had the JSON kind of its inferred type.
- `ComputeStep.apply` never threw.
- The 20 ill-typed or ill-formed probes were all rejected at validate/infer with sensible messages: if-branch mixes, non-boolean conditions, chaining, `and` with a float, boolean ordering, `abs($n > 1)`, `($n > 1) * 2`, `add_days($ts, $n > 1)`, `==`, `<>`, bare `not`, `$n = and`, `!`.
- Run: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 69` (66 HEL-1070 + 3 probe tests).
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1070/evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-skeptic-probe-spec.scala.txt`, `.../hel1070-skeptic-probe-output.txt`.

**Legacy fallback (same probe run, values printed).** Row: `price=4, and=2, true="T", True="U"`.
- Unchanged: `price * and` → `8.0`; `true + price` → `"T4"`; `True + price` → `"U4"`. Strict validate gives the `$`-prefix error, and the tolerant parser accepts each one.
- Changed: `true` → JSON `true` (inferred `boolean`). `and + 1` → reserved-word parse error, with no legacy retry. `not` → reserved-word error. `not + price` → "Unexpected token in expression: Plus", which is a syntax error and allowed by spec line 46. `true * 2` → per-row TypeError plus an analyze error.

This is exactly the design D1 / spec set. `LegacyParser` is untouched: the diff hunks in `ExpressionParser.scala` do not reach it.

**No Val site can MatchError.** `grep VStr|VNum|VNull|VBool` across `backend/src/main/scala` turns up only `ExpressionInterpreter` and `ExpressionDateTimeFunctions`. I read every match:
- `FieldRef`, `Neg` (`case other` → TypeError), `compare` (`case _` → TypeError), `evalBool`, `applyOp` (`+` via `isTextual`, else TypeError), `asText`.
- `substring`/`lower`/`upper`/`length` (have `other` arms), `round`/`mod`/`numericUnary` (`other` arms).
- `concatStr`, `typeName`, `valToJs` (all four cases), `instantOf` (VBool → None), `dateTrunc` (`case _`), `addDays` (`case other`).

`ComputeStep.apply` maps any `Left` to a row `null` (ComputeStep.scala:68-78). The probe's `noException should be thrownBy ComputeStep.apply(...)` passed on all 34 × 3.

**Mutation proof, re-run by me (none of these were run by the evaluator).** Throwaway worktree, `nice -n 19 sbt -batch -J-Xmx3g "testOnly com.helio.domain.engine.ExpressionBoolean* com.helio.domain.engine.ComputeConditionalCountSpec"`; each mutation was reverted with `git checkout` afterwards.
- M3, comparison made left-associative (chain accepted): `should reject a chained comparison *** FAILED ***`, guard `failed=1`. KILLED.
- M6, `if` evaluates both branches: `should evaluate only the chosen branch *** FAILED ***`, guard `failed=1`. KILLED.
- M10 (new), `or3(false,false)` → null: 3 tests FAILED (truth tables + both parity tests), guard `failed=3`. KILLED.
- **M11 (new), numeric `<=` → `<`** (`ExpressionInterpreter.compare`, `case "<=" => a <= b` → `a < b`): `[hel1468-guard] ScalaTest summary: failed=0`, `Tests: succeeded 68, failed 0`, EXIT 0. **SURVIVED.**
- **M12 (new), text `<=`/`>=` → strict** (`ord`: `c <= 0` → `c < 0`, `c >= 0` → `c > 0`): guard `failed=0`, `Tests: succeeded 68, failed 0`, EXIT 0. **SURVIVED.**
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1070/evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-skeptic-mut-{M3,M6,M10,M11,M12}.txt`; mutation definitions in `.../hel1070-skeptic-mutations.py.txt`.

Why: the only `<=` assertion, `ExpressionBooleanEvalSpec.scala:24` (`$amount <= 99` vs 100 → false), does not tell `<=` from `<`. Text ordering is tested only with `<` and `>` (lines 34-36). The parity spec checks only the JSON kind. The precedence and short-circuit mutations the AC names are genuinely killed. The off-by-one boundary of two of the six new operators is not.

**Seam fixture.** `shared-test-fixtures/compute-expression-functions.json` has functions (incl. `if`), `operators` (9) and `literals` (2). The backend `SupportedFunctions`/`SupportedOperators`/`BooleanLiterals` match it (read). The helio-mcp `COMPUTE_EXPRESSION_DOC` names `if`, all 9 operators and both literals (read). The live UI renders 15 function and 11 operator/literal items. I relied on the evaluator's pasted jest results, which are unambiguous (root jest 454 tests, frontend 5881, exit 0), and its pasted `testFull` guard line (`failed=0`, 7179 succeeded; persisted `hel1070-testfull-summary.txt`, which I read).

**Docs.** `docs/compute-expression-grammar.md` has the precedence table, the 3VL table, the if/boolean-column/legacy sections and the recipe. I checked these against the code and the probe outputs: `not $a = $b` = `not ($a = $b)`, `false or null` = null, `if` with null → else, and `$flag + 1` = `"true1"`. They are accurate. The "no conditionals (HEL-1070)" limitation was removed, and the Spark `F.expr` divergence is disclosed (pre-existing, SparkJobSubmitter.scala:245-246).

**UI / design judgment.** I opened the compute step editor → "Functions and operators" disclosure in dark and light themes (screenshots persisted below).
- Tokens: no CSS was changed; the component reuses the existing classes (`ReferenceList`), so tokens/shared-pattern compliance is inherited.
- Light/dark parity is fine.
- Console: only the pre-existing `GET .../schedule` 404.
- **Ligatures:** the code font (JetBrains Mono, `font-variant-ligatures: normal` measured via `getComputedStyle`) renders the reference's `a != b`, `a <= b`, `a >= b` as **`a ≠ b`, `a ⩽ b`, `a ⩾ b`**. This is a syntax reference whose whole job is to show the characters to type. Typing the glyph that is displayed (`≠`) fails with "Unexpected character". Screenshots:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1070/evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-skeptic-ops-dark.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1070/evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-skeptic-ops-light.png`

### Verdict: REFUTE

The feature is sound and the ticket's ask genuinely works. Two narrow, cheap defects block shipping as-is.

### Change Requests

1. **Prove the `<=`/`>=` equality boundary (mutations M11/M12 survive).** In `backend/src/test/scala/com/helio/domain/engine/ExpressionBooleanEvalSpec.scala`:
   - In "compare numbers numerically" (lines 19-28), add `$amount <= 100` vs 100 → `true` (kills M11).
   - In "compare text exactly" (lines 30-37), add `$s <= "a"` vs `"a"` → `true` and `$s >= "b"` vs `"b"` → `true`. Also add one strict case each for text `<=` and `>=` (e.g. `"a" <= "b"` true, `"b" >= "c"` false). These kill M12.
   - Then re-apply M11 and M12 exactly as defined in `hel1070-skeptic-mutations.py.txt` (numeric `case "<=" => a <= b` → `a < b`; `ord` `c <= 0` → `c < 0` and `c >= 0` → `c > 0`). Observe each red with a `[hel1468-guard] ... failed>=1` line, revert, and append both runs to `mutation-evidence.md`.
2. **Render the operator reference literally.** In `frontend/src/features/pipelines/ui/PipelineDetailPage.css:2117` (`.pipeline-detail-page__compute-functions-signature`), add `font-variant-ligatures: none;` so `!=`, `<=`, `>=` display as the characters the parser accepts, not `≠ ⩽ ⩾`. Re-screenshot the open disclosure in both themes to confirm. Scope it to the signature `<code>`; changing the app-wide mono font or the expression input is out of scope.

### Non-blocking notes

- The two lists in the disclosure run together. Nothing visual separates `upper(s)` from `a = b`; only the `aria-label`s differ. A small subheading or a `--space-*` gap before the operator list would help scanning. This is polish, not a blocker.
- `helio-mcp/src/tools/computeExpression.ts`: "a boolean column now reads as a boolean" uses a time-relative "now"; drop it.
- `ExpressionBooleanInferenceSpec.scala:100` has a scoped import inside a test body; move it to the top of the file (CONTRIBUTING imports rule).
- `red-evidence.md` and `mutation-evidence.md` were recorded with `testOnly` and quote no `[hel1468-guard]` line (C3). The evaluator's and my guarded runs supersede them; new evidence for CR1 should quote the guard line.
- Follow-through (collapse the roadmap dashboard's static % tiles, delete the `static` source) is post-merge operational work. Track it.
- Residue I could not remove: my CSV upload's file `csv/5bb35884-c76d-412d-81a6-65fe587e6d9b.csv` may remain under the backend's local uploads root (in `~`, which I may not write to). The DB rows are deleted.
- Process: the Playwright MCP writes page snapshots into the main checkout's gitignored `.playwright-mcp/`. I deleted my 7 by exact filename; no other main-checkout writes.
- Gate-defect check (CON-160): no report in this chain rests on mtime ordering; nothing to record.

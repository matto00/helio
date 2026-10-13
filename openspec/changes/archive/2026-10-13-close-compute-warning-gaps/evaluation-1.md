## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c58c71406f43843e8bf87fc7ce1a61947d5d85dc`. The diff base was resolved live with
`resolve-review-base.sh` to `8e18ed5459814fdc43143f8411c04494ba36a8c2`, the merge-base with origin/main.
origin/main has since moved to `ea04f2aa2` (HEL-1502 merged), and `git merge-tree` against it is clean.

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1 `string-body` / boolean in `+` | PASS. `TextLike` gains `string-body`, and tests cover both halves. A mutation that removes `string-body` turns 2 tests red (reproduced, see Phase 2). |
| AC2 per-column trust through compute | PASS. `Flags.untrusted`. Propagation checked: **rename** maps names, **select** intersects with the selected fields, **cast** removes the cast columns when the cast is trusted, **join/lookup** keep the left side's set and drop to `types=false` when the secondary has untrusted columns, every other trusted op passes the set through. A disabled step passes `in` through, and a validationError step becomes `Incomplete`. |
| AC2b join/lookup key trust per side | PASS. `columnTrusted(in, leftKey) && columnTrusted(sec.flags, rightKey)`. The left, right, lane and lookup scenarios are all tested. |
| AC3 cast regression | **FAIL (test gap).** The "legacy/unsupported cast target stays untrusted" half is not proven. See CR2. |
| AC4a `text-function-on-numeric-field` | PASS. It includes `substring` start/end as `numeric-op-on-text-field`, and the mixed-trust exemption is tested. |
| AC4b `literal-type-mismatch` | PASS. See "Literal positions" below. It is never a validationError: tested, and confirmed live (`canRun: true`, no `validationError`). |
| AC5 depth limits | PASS on behaviour, except that the limit-boundary scenario is only partly asserted (CR4). The red-first claims hold (see below). |
| AC6 contracts in sync | PASS. The schema enum, the frontend `AnalyzeWarningCode`, `helio-mcp/src/types.ts` and the three tool descriptions all list the same 6 codes. `check:schemas` and `check:helio-mcp-types` are green. |
| AC7 HEL-1301 residue user | PASS on outcome. `SELECT count(*) FROM users WHERE id='21d2ffee-…'` returns 0. The scratchpad `del.sql` is a `buildUserDeleteSql` transaction keyed on exact (id, `skeptic-hel1403-1791586664@example.test`). However, task 3.6 says "record before/after counts", and no committed or persisted artifact holds that record (see Suggestions). |
| AC8 / C2: no HEL-1502 area edits | PASS. `git diff --name-only BASE...HEAD` matches nothing under timestamp, datetime, cast or datebucket. `ExpressionParser` only wraps the existing `date_trunc` unit-message call in `nested(...)`, and `ExpressionDateTimeFunctions` itself is untouched. |
| C1: literals never an error | PASS |
| Regressions to other specs | **FAIL.** See CR1. A drive-by parser change alters which expressions parse. That breaks this change's own ADDED requirement ("Expressions within both limits SHALL parse and evaluate exactly as before") and the parser's documented legacy-fallback contract. |
| NumericOpOnTextFieldWarningSpec inversion | Confirmed deliberate. The `:128` per-step assertion is flipped and carries a comment citing HEL-1455 owner ruling 2. The neighbouring "upstream compute as TEXT (untrusted)" test still exists and still passes, and goes red under the untrusted-propagation mutation. |

**Literal positions vs spec.** `strLits` descends only through `+`. Nested `-`, `*`, `/` and unary `-` are visited as contexts of their own, so `floor(-"3")` warns with context `-`. `numLits` descends through `Neg` and `-`/`*`/`/`, never `+`. `coalesce`, `if` and comparisons are never entered. `seconds_between`, `add_days` arg 0 and the `date_trunc` unit are not numeric contexts. Probes on HEAD:
- `wrongTypeLiterals("seconds_between(\"2026-01-02\", $t)")` returns `Vector()`.
- `mod(5, "2")` returns `("2", mod)`, and evaluating it is a TypeError.
- `"3" * 2`, `length(5)`, `substring("abc","1",2)` and `-"3"` all evaluate to a TypeError, so "every row null" holds.

**Red-first evidence (executor claims, checked).** `red-depth.txt` / `red-four.txt` show `StackOverflowError` for the unary, strict-bracket and legacy-bracket shapes. They also show the 10000-term flat chain aborting with `StackOverflowError` in `ExpressionInterpreter.evalExpr` (an earlier run of the same test failed with `None.get` before reaching evaluation). I accept these as consistent with the code on base: `parseUnary`, `parseFactor` and `LegacyParser` recurse unbounded, and nothing bounded tree depth.

### Phase 2: Code Review — FAIL

**Gates I ran myself in WORKTREE_PATH. All passed.**
- `npm run lint` 0
- `npm run format:check` 0
- `npm run typecheck` 0
- `npm --prefix frontend run build` 0
- `npm test` 0 (579 suites / 6904 tests, plus 49 / 458)
- `check:schemas` 0
- `check:openspec` 0
- `check:spec-structure` 0
- `check:scala-quality` 0
- `check:helio-mcp-types` 0
- `HELIO_TEST_JVM_XMX=3g nice -n 19 sbt testFull`: exit 0, 7654 succeeded, 0 failed

**Mutation check, re-run by me.** I ran it in a throwaway detached worktree at HEAD, and removed that worktree afterwards. I applied three mutations at once:
1. Drop `string-body` from `TextLike`.
2. Make compute no longer add its column to `untrusted`.
3. Revert the `if (inner.isLeft) inner` line.

13 tests went red: both item-1 tests, all the untrusted / rename / select / mixed-trust / join-key / lookup tests, the strict deep-bracket test, the 100/101 boundary test, and the existing "upstream compute as TEXT" test. With no mutation, the same 4 suites passed 65/65.

Issues:
- **CR1 (spec-divergence, drive-by behaviour change).** `ExpressionParser.scala:271` `if (inner.isLeft) inner` makes a failed bracket group return the inner error, where it used to return "Expected closing ')'". When that inner error is the `$`-prefix error, `parseProblem`, `compile` and `evaluate` now take the legacy fallback for bare identifiers inside brackets.

  Measured with the same probe spec at HEAD and with only that line reverted:

  | Expression | Reverted (base) | HEAD |
  |---|---|---|
  | `(x) + 1` | `Some(Expected closing ')')` | `None`, evaluates to `4.0` |
  | `(x * 2)` | `Some(Expected closing ')')` | `None`, evaluates to `6.0` |
  | `floor((x))` | `Some(Expected closing ')')` | `Some(Unexpected token in expression: FnName(floor))`, a legacy-parser message |
  | `($a == 1)` / `(1 +` | `Some(Expected closing ')')` | the inner message |

  So expressions that used to be rejected at save now save, and an expression already stored in this shape that nulled every row now produces values. None of this is in the proposal, design, spec or tests. It also contradicts the new requirement "Expressions within both limits SHALL parse and evaluate exactly as before".
- **CR2 (spec-divergence / vacuous test).** `ComputeTypeWarningsSpec.scala:113` "keep a legacy/unsupported cast target untrusted (no warning either way)" uses `"double"`. That target **is** in `CastStep.SupportedTargets` (`CastStep.scala:72`), so this cast is trusted and projects `float`. The test passes whether or not legacy targets stay untrusted, and its label is wrong. AC3's second half has no real test.
- **CR3 (mechanical, CONTRIBUTING "Imports & Qualifiers").** `ExpressionParser.scala:88` contains `scala.collection.mutable.Stack[(Expr, Int)]`, an inline fully-qualified name. `check:scala-quality` does not catch this prefix, but the rule is explicit.
- **CR4 (spec scenario not asserted).** compute-expression-language "nesting at the limits still works" requires the expressions to "parse and evaluate to `1` and `200`". `ExpressionDepthLimitSpec.scala:43` and `:68` only assert `parseProblem == None`. The 512 KB headroom test evaluates, but discards the result.

Everything else checked out:
- **DRY:** `nodes`, `numericOperands`, `textOperands` and `collect` are shared by all three scans.
- **Stack safety:** the iterative `nodes` and `treeDepth` cannot overflow.
- **Mixed-trust exemption:** matches the design.
- **Typing and error handling:** no untyped escape hatches, and every config decode is `Try`-guarded.
- **File-size budgets:** `ExpressionParser` (344) and `AnalyzeSchemaWarnings` (303) are over their soft budgets, but both already were; soft only.

### Phase 3: UI Review — PASS

Phase 3 was triggered (`frontend/**`, `schemas/**`). The only frontend change is the `AnalyzeWarningCode` union. A grep shows no per-code switch anywhere in `frontend/src`, so rendering is generic.

**Live check.** I started servers with `start-servers.sh` and `assert-phase.sh` (PASS servers on 6887/9794) and used a throwaway `evalr-hel1455-1791876052@example.test` user with the finance template. I added three computes:
- `length($amount_usd)`
- `"3" * 2`
- `floor($merchant)`, placed after the other computes, which exercises per-column trust

Analyze returned exactly one `text-function-on-numeric-field`, one `literal-type-mismatch` and one `numeric-op-on-text-field` (on `merchant`, after two upstream computes), with `costVerdict.canRun: true` and no `validationError`.

`validate-expression` over HTTP returned `200 {valid:false}` with the nesting message for 10000 `-` and for `x + ((…))`, and the tree-depth message for a 10000-term `+` chain. No 500s.

The StepCard showed all three messages under "Check before running (these don't block runs)". Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1455/evidence/.playwright-mcp/evalr-hel1455-compute-warnings-1440.png`.

Other observations:
- **Console:** only a pre-existing `GET /api/pipelines/:id/schedule` 404 (no schedule set) and unauthenticated errors before login. Nothing came from this change.
- **Breakpoints:** not re-measured, because the diff changes no markup or CSS.

**Teardown.** I deleted the user by exact (id, email) with `buildUserDeleteSql` through `e2e/support/db.cjs` (before 1, after 0, pipelines left 0). I stopped the servers with `stop-servers.sh` (STOPPED ports=6887,9794).

### Overall: FAIL

### Change Requests
1. **`backend/src/main/scala/com/helio/domain/engine/ExpressionParser.scala:269-273`.** Keep the pre-change bracket-group result for every inner failure except the nesting-limit error. For example: `if (inner == Left(NestingMsg)) inner else if (peek != Token.RParen) Left("Expected closing ')'") else { advance(); inner }`.

   Then add a regression test in `ExpressionDepthLimitSpec` (or `ExpressionEvaluatorSpec`) asserting:
   - `parseProblem("(x) + 1") == Some("Expected closing ')'")`
   - `evaluate("(x * 2)", Map("x" -> JsNumber(3)))` is `Left(ParseError("Expected closing ')'"))`

   Show the new test red against the current line. If the team actually wants bare identifiers in brackets to fall back to legacy, that is a separate product decision. It would need its own spec change, not a silent side effect of the depth guard.
2. **`backend/src/test/scala/com/helio/domain/engine/ComputeTypeWarningsSpec.scala:113`.** Replace the `"double"` cast with a stored legacy target that projects a text type, e.g. `{"casts":{"price":"string-body"}}` followed by `floor($price)`, and assert there is no `numeric-op-on-text-field` warning. Fix the test name to match. Prove it can go red: temporarily make `castTrusted` return `true`, and the test must fail.
3. **`backend/src/main/scala/com/helio/domain/engine/ExpressionParser.scala:88`.** Import `scala.collection.mutable` at the top of the file, as `ExpressionNumericContexts` does, and write `mutable.Stack[(Expr, Int)]`.
4. **`backend/src/test/scala/com/helio/domain/engine/ExpressionDepthLimitSpec.scala:43/68`.** Add the assertions the spec scenario requires:
   - `ExpressionEvaluator.evaluate("-" * 100 + "1", Map.empty)` evaluates to 1.
   - `evaluate(flat("+", 200), Map.empty)` evaluates to 200.

   Compare in whatever value form `evaluate` returns (e.g. `Right(JsNumber(...))` or `Right(1.0)`).

### Non-blocking Suggestions
- Record the HEL-1301 residue deletion (exact id and email, before count 1, after count 0) in `files-modified.md` or the PR body, so task 3.6's "record before/after counts" exists outside the executor's scratchpad.
- `ComputeTypeWarnings.textFunctions` filters `untrusted` twice: once inside `numericFieldsInTextFunction`, which returns nothing for any argument that references an untrusted field, and again in `filterNot`. The outer filter is redundant.

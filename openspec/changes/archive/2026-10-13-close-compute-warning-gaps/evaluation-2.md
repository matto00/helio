## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `e114682d689df50f0cb341070bf3c4463755ea7a`. The diff base was resolved live with
`resolve-review-base.sh` to `8e18ed5459814fdc43143f8411c04494ba36a8c2`. `git merge-tree` against origin/main is clean (HEL-1502 `ea04f2aa2` is included there).

The cycle-2 delta from `c58c71406` touches 4 files: `ExpressionParser.scala`, `ComputeTypeWarningsSpec.scala`, `ExpressionDepthLimitSpec.scala` and `tasks.md`. Nothing changed under `frontend/`, `schemas/` or `helio-mcp/`.

### Phase 1: Spec Review — PASS
Issues: none.

| Item | Result |
|---|---|
| CR1 | Fixed. See Phase 2. |
| CR4 | Fixed. The spec scenario "nesting at the limits still works" is now asserted. `evaluate` of 100 nested unary minuses gives `Right(JsNumber(1))`. `evaluate` of a flat 200-term `+` chain gives `Right(JsNumber(200))`. 100 nested brackets and a flat 200-term `*` chain are also evaluated. |
| CR2 | Fixed. AC3's untrusted-legacy-cast half is now tested for real (see Phase 2). |
| Task 3.6 | Now records the deletion: the exact (id, email), `buildUserDeleteSql`, users 13134 -> 13133, target 1 -> 0. In cycle 1 I independently confirmed the target row is 0. |
| C1 | Still honored. Nothing in the delta touches the literal warning. |
| C2 | Still honored. No file under the timestamp, datetime, cast or datebucket areas is in `BASE...HEAD`. |

Every other Phase 1 finding from evaluation-1.md still holds unchanged.

### Phase 2: Code Review — PASS

**Gates I ran myself on e114682d6 in WORKTREE_PATH:**
- `HELIO_TEST_JVM_XMX=3g nice -n 19 sbt testFull`: exit 0, 7655 succeeded, 0 failed. That is one more test than cycle 1: the new bracket regression test.
- `npm run lint`, `npm run format:check`, `npm run typecheck`: all 0.
- `npm test`: 0 (579 suites / 6904 tests, plus 49 / 458).
- `check:schemas`, `check:openspec`, `check:spec-structure`, `check:scala-quality`, `check:helio-mcp-types`: all 0.
- I did not re-run the frontend build, because no frontend file changed since cycle 1's passing build.

**Mutation check, re-run by me.** I used a throwaway detached worktree at e114682d6 and removed it afterwards. I applied two mutations together:
- `if (inner == Left(NestingMsg))` reverted to `if (inner.isLeft)`.
- The `cast` trust check forced to `true`.

Exactly the two new tests went red:
- "keep a legacy/unsupported cast target (string-body) untrusted: floor($price) stays silent"
- "still reject a bare identifier inside brackets with the closing-bracket error"

The other 42 tests in the two suites stayed green.

**CR1.** `ExpressionParser.scala:273` is now `if (inner == Left(NestingMsg)) inner`, followed by the old `peek != RParen` / `advance` logic. That is exactly the old bracket-group behaviour plus pass-through of the limit error. The new test pins "Expected closing ')'" for `(x) + 1`, `(x * 2)` and `floor((x))`, which are the exact base results I measured in cycle 1. The deep-bracket nesting tests still pass in testFull.

**CR2.** The test now asserts `CastStep.SupportedTargets should not contain "string-body"` and uses a `string-body` cast. That target projects a text type, so the test would warn if the cast were trusted. The mutation above proves it.

**CR3.** `import scala.collection.mutable.Stack` is at the top of the file, and the inline name is gone.

Issues: none.

### Phase 3: UI Review — PASS

Nothing under `frontend/**`, `schemas/**` or `openspec/specs/**` changed since cycle 1, and `ApiRoutes.scala` is untouched. The cycle-1 live UI and API verification therefore still applies to this HEAD. Its evidence is `/home/matt/Development/helio/.concertino/runs/HEL-1455/evidence/.playwright-mcp/evalr-hel1455-compute-warnings-1440.png`.

The only backend behaviour change since then restores the base parse results. It is covered by the tests above, so I did not repeat the live check.

### Overall: PASS

### Non-blocking Suggestions
- `ComputeTypeWarnings.textFunctions` still applies a redundant second `filterNot(untrusted)` (carried over from cycle 1).
- `ExpressionParser.scala` is 347 lines against a soft budget of 250. It was already over the budget before this change, and the budget is soft only.

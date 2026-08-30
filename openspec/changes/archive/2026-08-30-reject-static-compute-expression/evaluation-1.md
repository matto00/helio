## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- AC1 (reject at step-create with the evaluator's own message): met. `ComputeStep.companion.validateRawConfig` (ComputeStep.scala:96-101) composes with `super` and surfaces the parser's own string; verified red on `main` at the real route (see Phase 2 evidence audit).
- AC2 (pre-existing step fails the run naming step id/kind/parse error): met via `requiredConfigProblems` (ComputeStep.scala:111-117) → `InProcessPipelineEngine:145` → `StepExecutionException.from`. Verified red on `main` end-to-end.
- AC3 (per-row divide-by-zero / null operand still null, run continues): behaviour is correct and was never broken; its measurement is the one shortfall — see Change Request 1.
- AC4 (empty expression stays saveable, fails at run via required-config): met — `.trim.isEmpty` short-circuit, guard tests present and green.
- AC5 (nothing on the read path): met and independently checked — `grep` finds no `parseProblem`/`validate` reference in `PipelineStepRepository` or `ComputeConfig.decode`; both new checks take `raw` and are called only from write/run surfaces.
- AC6 (assert on materialised rows, not on the stored-config round-trip): met for the static-parse case (task 3.2, `dataTypeRowRepo.listRows`), NOT met for the per-row case (task 4.1) — Change Request 1.
- Write-surface enumeration re-derived from the tree rather than trusted: `PipelineService:494` (create), `PipelineService:670` (update), `PipelineProposalService:187`, `PatchSetApplyResolvers:240`, plus `PipelineAnalyzeService:128`. All five reach the single override; design Decision 4's two-prefix trade is real and correctly asserted by substring in the analyze test.
- No scope creep: diff is confined to the two `main` files named in the proposal plus tests and change docs. No frontend, no schema, no migration.
- Planning prose matches the shipped code, including the `parsed once per step` SHALL in the `pipeline-compute-op` delta (task 4.2 was implemented, not dropped, so the SHALL is met).

### Phase 2: Code Review — FAIL

Gates re-run by me, fresh, in `WORKTREE_PATH` (not taken from the executor's report):

- `cd backend && sbt test` → `Tests: succeeded 3841, failed 0` / `All tests passed` / `[success] Total time: 210 s`.
- `node scripts/check-scala-quality.mjs` → `clean (144 soft warning(s))`, none introduced by this diff.
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`.
- Root `npm test` deliberately NOT run/cited: vacuous inside a worktree (HEL-880), and the frontend is untouched.

#### Independent verification of the proof/guard split (the ticket's central requirement)

I did not accept the executor's labels. I created a throwaway detached worktree at the base commit `82026d58` (un-fixed `main`), checked out ONLY `backend/src/test` from `737fb1ee` into it (reverting `ExpressionEvaluatorSpec` alone, since its new block cannot compile without `parseProblem`), and ran the four affected suites. Result: `Tests: succeeded 138, failed 7`. The 7 red-on-main tests are:

1. `ComputeStepSpec` — "reject the production expression …" (task 2.1)
2. `PipelineStepRequiredConfigSpec` — "fail a compute step whose expression is unparseable …" (task 3.1)
3. `PipelineStepRequiredConfigSpec` — analyze "report a compute step with an unparseable expression …" (task 3.5a)
4. `PipelineRunServiceSpec` — "fails the real run … writes no output rows with a null-filled compute column" (tasks 3.1/3.2, materialised rows)
5. `PipelineRunServiceSpec` — "preview fails with the attributed parse error …" (task 3.5b)
6. `PipelineStepRoutesSpec` — "POST … returns 422 … and creates no step" (task 2.2)
7. `PipelineStepRoutesSpec` — "PATCH … returns 422 … leaving it unchanged" (labelled a GUARD, task 2.6)

Every test the executor labelled a GUARD was confirmed GREEN on un-fixed `main` in the same run — including the relabelled task 4.1 ("divide-by-zero and null-operand rows"), the empty/whitespace drafts, the legacy bare-identifier cases (companion and route), the read-path decode tolerance, and the empty-expression ordering guard. **The executor's relabel of 4.1 from proof to guard is verified honest and correct.**

Two accuracy corrections to the reported split, neither adversarial:
- The claimed 7th proof (task 1.2, `parseProblem` on the production expression) is red on `main` only as a *compile* failure — `parseProblem` does not exist there. That is a weak form of red; the behavioural red for the same expression is genuinely carried by items 1, 2, 4, 6 above, so the claim is not inflated in substance.
- Item 7 (PATCH update) is labelled a guard but is in fact red on un-fixed `main`, i.e. proof. Under-claimed, which is the safe direction.

Net: 7 behavioural reds on un-fixed `main`. No evidence-shaped non-evidence found in the proof set: the route tests hit the real route + real Postgres-backed repository (not the companion directly), the run test asserts on `dataTypeRowRepo.listRows` after a real `service.submit`, and the null-column assertion is non-vacuous because on `main` that same call returned 2 rows carrying `value_vs_adp: null` (reproduced in my red run).

#### Code correctness checks made against the code, not the prose

- **`parseProblem` vs `evaluate` agreement.** Confirmed by construction (`evaluate = compile(...).flatMap(_.eval)`, and `compile`'s parse arm is `parseProblem`'s arm with evaluation attached) and confirmed empirically in a `sbt console` probe on the built worktree classes: `$a + $b` → `None`/`Right(3.0)`; `a + b` (legacy bare identifier) → `None`/`Right(3.0)`; `stats.x - stats.y` → `Some(Invalid number literal: .)`/`Left(ParseError(...))`; `$a +` → `Some(Unexpected end of expression)`/matching `Left`. I specifically probed the one path that could have made them disagree — `evalExpr` can emit `EvaluationError.ParseError` at ExpressionEvaluator.scala:643 (`Unknown function`) *after* parsing — and it does not: `foo($a)` and `sqrt($a)` both return `Some('foo'/'sqrt' is not a recognized function)` from `parseProblem` and the identical `Left(ParseError(...))` from `evaluate`. Function-name validation happens during parse, so no drift.
- **Write path does not gate on strict `validate`** (design Decision 1): confirmed in code and by the green route guard "still accepts a legacy bare-identifier compute expression" (`price * qty` → 201 Created).
- **Read path untouched**: no expression check in `ComputeConfig.decode` or `PipelineStepRepository.rowToDomain`; guard test decodes an unparseable stored expression without raising.
- **Empty and whitespace-only expressions still save**: `.trim.isEmpty` short-circuit, guards green on both `main` and HEAD.
- **Per-row failures still yield null without failing the run**: behaviour verified green; measurement shortfall is Change Request 1.
- **`compile`/`CompiledExpression` refactor is behaviour-preserving**: `evaluate` is now `compile(expr).flatMap(_.eval(row))`, which is a mechanical extraction of the identical three-branch parse arm — same messages, same `Left(ParseError)` construction, same legacy retry condition. Its two out-of-scope callers are safe: `SourceService.applyComputedFields` (SourceService.scala:404) still calls `evaluate` with an unchanged signature and unchanged semantics, and `DataTypeService` (:70, :107) does not call `evaluate` at all — it uses `validateTolerant`, which this change does not touch. `ComputeStep.apply` keeps its `Left(_) => null` fallback for the unparseable case, so the pure function's contract is identical for a direct caller. Full-suite green (3841) is consistent with this.
- DRY / readability / modularity / no dead code / no over-engineering: clean. `CompiledExpression` keeps the AST private, which is the right narrow widening of the public surface. Comments are load-bearing and cross-reference each other as the Risks section required. No `any`-equivalent escape hatches, no security surface touched, no TODO/FIXME added, no inline fully-qualified names.

The single blocking finding is the one below.

### Phase 3: UI Review — N/A

Stated explicitly rather than silently skipped: this change is backend-only. `git diff --name-only main...HEAD` touches only `backend/src/{main,test}/scala/**` and `openspec/changes/reject-static-compute-expression/**`. None of the Phase-3 triggers match — no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, and no `openspec/specs/**` (the spec deltas live under the change directory, not the published specs tree). No dev server was started and none was required.

### Overall: FAIL

### Change Requests

1. **Task 4.1 does not assert on materialised rows, and its comment says it does.** `PipelineStepRequiredConfigSpec` ("GUARD: a compute step with a parseable expression over divide-by-zero and null-operand rows …") asserts on `Await.result(engine.execute(mixedRows, Seq(step), null), 5.seconds)` — the in-memory return value of a direct `engine.execute` call — while its own comment reads "on MATERIALISED ROWS, not a function return". It is a function return. Ticket AC6 ("assert on the materialised rows") and tasks.md 4.1 both require the real run path for exactly this criterion, and AC3 is the criterion the split hinges on, so this is the one place the evidence is weaker than its label.
   Fix: add the per-row case to `PipelineRunServiceSpec` alongside the existing task-3.2 test, so it runs through `service.submit` and asserts on `await(dataTypeRowRepo.listRows(outputDataTypeId.value))`: the run succeeds (`Right`), the divide-by-zero / null-operand rows carry `JsNull` for the computed column, and the other rows carry their computed values. The existing `seedDsWithData()` fixture (rows `alice/42.0`, `bob/37.0`) already supports a divide-by-zero row without a new fixture — e.g. `expression = "$score / ($score - 42)"` gives `null` for alice and `-7.4` for bob; seed one extra row with a null `score` (or add a `seedDsWithRows(json)` variant) to cover the null-operand half the ticket names.
   Then correct the comment in `PipelineStepRequiredConfigSpec` so it no longer claims materialised rows — keep that test as the engine-level guard it actually is, and point it at the new materialised test.

### Non-blocking Suggestions

- Task 1.2's red is a compile failure, not a behavioural one. Consider saying so in the evidence report verbatim ("did not compile" is already in the test comment — good) rather than counting it in the same bucket as the six behavioural reds; the substance is fine, only the bookkeeping is loose.
- The PATCH-update test (task 2.6) is red on un-fixed `main` and is therefore proof, not a guard. Worth relabelling upward for an accurate final count.
- The task-1.3 agreement guard's expression set contains no function-call case. It passes, and I verified independently that no divergence exists there, but adding `foo($a)` to the set would pin the one arm (`evalExpr`'s `Unknown function` → `ParseError` at ExpressionEvaluator.scala:643) that could make `parseProblem` and `evaluate` drift if function-name checking ever moved out of parse.

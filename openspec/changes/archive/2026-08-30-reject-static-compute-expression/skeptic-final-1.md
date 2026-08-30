## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `fae992de` against base `82026d58`. Every conclusion below comes from a
command I ran or a file I read in this worktree; the executor's and evaluator's reports
were read only as claims.

### What I verified (with evidence)

**1. Full backend suite, run by me.**
`cd backend && sbt test` in `WORKTREE_PATH` →
`Tests: succeeded 3842, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed` /
`[success] Total time: 210 s`. Root jest not run or credited (vacuous in a worktree, HEL-880;
`git diff --name-only 82026d58...HEAD | grep -c frontend` → `0`, so the frontend is genuinely
untouched).

**2. The proof/guard split — reproduced independently, not accepted.**
I made my own throwaway detached worktree at `82026d58` (un-fixed `main`), checked out only the
four changed test files from `fae992de` into it (omitting `ExpressionEvaluatorSpec`, whose new
block cannot compile without `parseProblem`), copied `backend/.env`, and ran those four suites:

```
Total number of tests run: 146
Suites: completed 4, aborted 0
Tests: succeeded 139, failed 7
```

The 7 reds are exactly the 7 claimed, and nothing else:
`ComputeStepSpec` "reject the production expression…" (2.1); `PipelineStepRequiredConfigSpec`
"fail a compute step whose expression is unparseable…" (3.1) and analyze "report a compute step
with an unparseable expression…" (3.5a); `PipelineRunServiceSpec` "fails the real run…" (3.1/3.2)
and "preview fails…" (3.5b); `PipelineStepRoutesSpec` POST 422 (2.2) and PATCH 422 (2.6).
Every test labelled GUARD ran GREEN on un-fixed `main` in the same run, including the empty /
whitespace drafts, both legacy bare-identifier guards (companion and route), the read-path decode
guard, the empty-expression ordering guard, and the new materialised-rows per-row guard. So the
reported split — 7 behavioural proofs, 1 compile-only proof bucketed separately, remainder guards
— is accurate as measured, not as asserted. This also independently confirms the cycle-2 relabels
(2.6 up to proof, 4.1 down to guard) are honest in both directions.

The red output itself shows the production defect verbatim, on `main`:
`Right(RunResultResponse(Vector({"name":"alice","score":42.0,"value_vs_adp":null}, {"name":"bob","score":37.0,"value_vs_adp":null}), …)) was not an instance of scala.util.Left`.

**3. I probed the one assertion I suspected of being evidence-shaped non-evidence.**
Task 3.2's materialised-row assertion (`rows.exists(_.fields.contains("value_vs_adp")) shouldBe
false`) sits *after* `result shouldBe a[Left[_,_]]`, so in the red run above it is never reached —
the test aborts on the earlier assertion. That makes its comment's claim ("`listRows` held 2 rows
each carrying `value_vs_adp: null`") unmeasurable *by that test as written*, and leaves open that
the row assertion is decorative (on HEAD the run fails, so `listRows` could simply be empty and the
assertion vacuously true). I did not accept either the claim or my own suspicion — I measured it.
In the un-fixed worktree I patched the test to drop the `Left` assertions and print the row
snapshot instead, and ran it:

```
SKEPTIC_PROBE_result=true
SKEPTIC_PROBE_rowcount=2
SKEPTIC_PROBE_row=TreeMap(name -> "alice", score -> 42.0, value_vs_adp -> null)
SKEPTIC_PROBE_row=TreeMap(name -> "bob",   score -> 37.0, value_vs_adp -> null)
```

`dataTypeRowRepo.listRows` really does return two materialised rows with a null-filled compute
column on un-fixed `main`, and `rows.exists(...) shouldBe false` is genuinely red there. The
comment is true and the assertion is real proof, not decoration. AC6 is met for the static case
through the real Postgres-backed row snapshot.

**4. AC6 for the per-row case (task 4.1's replacement) goes through the real run path, and is
non-vacuous by construction.** `PipelineRunServiceSpec` "GUARD: a parseable expression over
divide-by-zero and null-operand rows persists null for those rows only" calls
`service.submit(pid, isDry = false, …)` and asserts on `dataTypeRowRepo.listRows(...)`. It cannot
pass vacuously: `r.fields("ratio")` throws on an absent column, `byName("carol")` throws if the
null-operand row were dropped, and `byName("bob") shouldBe JsNumber(-7.4)` is a positive control
proving the column was actually computed rather than uniformly nulled. It ran green on un-fixed
`main` in my red run, so GUARD is the correct label — the executor did not inflate it into proof.
Its engine-level sibling in `PipelineStepRequiredConfigSpec` now correctly describes itself as an
in-memory `engine.execute` return, not materialised rows; I read both comments against both bodies.

**5. Acceptance criteria traced to code and to a red.**
- AC1 (reject at create with the evaluator's own message): `ComputeStep.scala:95-101` composes with
  `super`; red at the real route (POST 422, proof 2.2) and at the companion (proof 2.1). The message
  carried is the parser's own (`Invalid number literal`), asserted by substring.
- AC2 (pre-existing step fails the run naming step id, kind, parse error):
  `ComputeStep.scala:110-117` → `InProcessPipelineEngine:145`; proof 3.1 asserts `stepId`,
  `stepKind`, and the parse text, and the end-to-end proof asserts all three in the run error.
- AC3 (per-row failure still null, run continues): verified at both levels (item 4), with the
  divide-by-zero and null-operand rows named separately and a computing row as control.
- AC4 (empty expression still saveable, still fails at run): `.trim.isEmpty` short-circuit on the
  write path, `missingRequired` taking precedence on the run path; guards green on both sides, and
  the ordering guard asserts the exact `missingRequired` wording rather than a substring loose
  enough to also match the parse branch.
- AC5 (nothing on the read path): I grepped the whole `main` tree myself —
  `ExpressionEvaluator.` appears in `ComputeStep`, `PipelineAnalyzeService`,
  `PatchSetPreviewProjection`, `DataTypeService`, `SourceService`; `parseProblem` appears only in
  `ComputeStep`'s two companion overrides. Neither `ComputeConfig.decode` nor
  `PipelineStepRepository.rowToDomain` is touched by the diff, and a guard decodes an unparseable
  stored expression without raising.
- AC6: items 3 and 4.

**6. `parseProblem` / `evaluate` agreement — checked in the grammar, not in the prose.**
`parseProblem` (`ExpressionEvaluator.scala:378`) and `compile` (`:513`) are the same three-arm
parse with and without evaluation, and `evaluate` is now literally `compile(expr).flatMap(_.eval(row))`.
The only way they could disagree is a `ParseError` raised *after* parsing — there is exactly one,
`ExpressionEvaluator.scala:643` (`Unknown function`), and I confirmed it is unreachable: unknown
function names are rejected during parse by `checkArity` (`:277`), and `LegacyParser.parseFactor`
(`:331-341`) has no function-call case at all, so no `Call` node can ever reach `applyFn` with an
unrecognised name via the legacy fallback either. **The evaluator's un-pinned arm (`foo($a)` absent
from the 1.3 agreement set) therefore does not matter today** — it is a non-blocking hardening note,
not a defect. Recorded below.

**7. The load-bearing decision: the write path does not gate on strict `validate`.**
Confirmed in code (`validateRawConfig` calls `parseProblem`, never `validate`) and behaviourally:
the route guard "still accepts a legacy bare-identifier compute expression" POSTs `price * qty` and
gets `201 Created` in the green suite, and the companion guard asserts `validate` *fails* for the
same expression while `validateRawConfig` returns `None` — so the guard would go red the moment
someone swapped in `validate`. `price * qty` is not 422'd.

**8. The `compile`/`CompiledExpression` refactor is behaviour-preserving.** It is a mechanical
extraction: identical branch order, identical `isDollarPrefixError` retry condition, identical
`ParseError` construction and messages. `ComputeStep.apply` keeps a total `Left(_) => null`
fallback, so the pure function's contract is unchanged for a direct caller. Out-of-scope callers
are unaffected — `SourceService.scala:404` still calls `evaluate` with an unchanged signature;
`DataTypeService:70,:107` and `PatchSetPreviewProjection:257` use `validateTolerant`, which this
change does not touch. Full-suite green (3842) is consistent.

**9. Write-surface reach re-derived from the tree, not from the design doc.**
`grep -rn "validateRawConfig"` over `backend/src/main` → `PipelineService:494` (create),
`PipelineService:670` (update), `PipelineProposalService:187`, `PatchSetApplyResolvers:240`, plus
`PipelineAnalyzeService:128`. All five resolve the companion via `PipelineStep.companionFor`, so the
single override reaches every one; the base is `PipelineStep.scala:130`. Design Decision 4's
two-prefix trade (`"compute: invalid expression: "` at analyze via `shapeRejection`, `"invalid
expression: "` at run) is real and is asserted by substring rather than equality, which is the
correct choice given the two prefixes.

**10. Spec-delta consistency.** Task 4.2 was implemented rather than dropped, so the
`pipeline-compute-op` delta's "The expression SHALL be parsed once per step evaluation rather than
once per row" is met by `ComputeStep.apply`'s hoisted `compile`. The change ships no SHALL it does
not meet. Scope is clean: two `main` files, four test files, change docs — no frontend, no schema,
no migration.

### UI / design judgment — N/A

Stated rather than silently skipped. `git diff --name-only 82026d58...HEAD` touches only
`backend/src/{main,test}/scala/**` and `openspec/changes/reject-static-compute-expression/**`;
`grep -c frontend` over that list returns `0`. No `frontend/**`, no `schemas/**`, no
`openspec/specs/**`, no `ApiRoutes.scala`. No dev server was started, and none was needed.

### Verdict: CONFIRM

The central requirement of this ticket was evidence quality, and it holds up under an independent
red run I performed myself: 7 real behavioural reds on un-fixed `main`, guards honestly labelled
and green there, one compile-only red bucketed separately and named as weak, and the one assertion
I actively suspected of vacuity (task 3.2's materialised-row check) proven genuinely red on `main`
by direct probe. The two relabels made in cycle 2 both move toward accuracy. Correctness holds on
every point in the brief.

### Non-blocking notes

- The task-1.3 agreement guard still has no function-call case. I verified there is no divergence
  today (item 6) and the arm is unreachable, so this is not a defect — but adding `foo($a)` to the
  `cases` set would pin `ExpressionEvaluator.scala:643` against a future refactor that moved
  function-name checking out of `checkArity`. One line, cheap insurance on the change's single
  identified drift risk. Carried unchanged from both evaluation cycles.
- Task 3.2's materialised-row assertion is currently ordered after the `Left` assertion, so on a
  green HEAD it never observes a non-empty row set. It is real proof (it is red on `main` — I
  measured it), but if someone later reorders or removes the `Left` assertion, the row check would
  silently become vacuous. Not worth changing now.
- `evaluation-2.md` is untracked in the worktree (`git status --short` → `?? …/evaluation-2.md`).
  Housekeeping for whoever commits the change docs; no bearing on the code.

## Evaluation Report — Cycle 2 (evaluation-2.md)

Re-evaluation of `fae992de` ("Add materialised-rows test for per-row null semantics; correct evidence labels") on top of cycle 1's `737fb1ee`. Cycle 1's verdict was FAIL on a single change request.

### Phase 1: Spec Review — PASS

- **Production behaviour is untouched, verified rather than assumed**: `git diff --stat 737fb1ee..fae992de -- backend/src/main` is empty. The cycle-2 diff is four test files plus `files-modified.md`. Everything I cleared in cycle 1 (all six acceptance criteria, the five write surfaces, design Decisions 1/3/4/5/6) therefore stands unchanged and is not re-litigated here.
- **AC3 + AC6 are now jointly satisfied.** Cycle 1's only gap was that AC3 (per-row divide-by-zero / null operand) was measured on an in-memory `engine.execute` return rather than on materialised rows as AC6 requires. That is now closed — see Change Request 1 below.
- Planning prose still matches the code; `files-modified.md` was updated accurately and, notably, in the *self-correcting* direction (it now records the compile-only nature of task 1.2's red and the cycle-1 mislabel it fixed, rather than quietly overwriting the history).

### Phase 2: Code Review — PASS

Gates re-run by me, fresh, in `WORKTREE_PATH`:

- `cd backend && sbt test` → `Tests: succeeded 3842, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed` / `[success] Total time: 211 s`. (3841 in cycle 1; +1 is exactly the new test.)
- Root `npm test` again deliberately not run or credited — vacuous inside a worktree (HEL-880), frontend untouched.

#### Change Request 1 — DISCHARGED

**The new test goes through the real run path.** `PipelineRunServiceSpec` "GUARD: a parseable expression over divide-by-zero and null-operand rows persists null for those rows only, and the run succeeds" does all four things the change request asked for:
- runs through `await(service.submit(pid, isDry = false, dummyUser))` — the real run path, not `engine.execute`;
- asserts the run succeeds: `result shouldBe a[Right[_, _]]`;
- asserts on materialised rows: `await(dataTypeRowRepo.listRows(outputDataTypeId.value))`;
- asserts both AC3 cases *and* the negative control — `byName("alice") shouldBe JsNull` (divide-by-zero, `42 / (42 - 42)`), `byName("carol") shouldBe JsNull` (null operand, `score` stored NULL), `byName("bob") shouldBe JsNumber(-7.4)` (the row that must still compute, `37 / (37 - 42)`).

**The misleading comment was corrected.** `PipelineStepRequiredConfigSpec`'s task-4.1 comment no longer claims "on MATERIALISED ROWS". It now reads "ENGINE-LEVEL — a direct `engine.execute` call, i.e. an in-memory function return, NOT materialised rows", explicitly records that evaluation-1.md caught the false claim, and points at its materialised-rows counterpart in `PipelineRunServiceSpec`. The test is kept for what it honestly is: a fast, DB-free engine-level guard.

**The new test is not vacuous — proven by mutation, not by reading.** This was the specific evidence-shaped-non-evidence risk, so I probed it rather than trusting the assertion's shape. In a throwaway worktree I mutated the expectations to `byName("carol") shouldBe JsNumber(999)` and `byName("bob") shouldBe JsNumber(-999)` and re-ran the single test. It failed with:

```
null was not equal to 999 (PipelineRunServiceSpec.scala:965)
```

That is decisive on every count the change request raised: the failure is a *value* mismatch, not a `NoSuchElementException` / "key not found". So the `carol` row really is present in the materialised row set, it really carries the computed `ratio` column, and that column's persisted value really is `JsNull` — the assertion is not passing because the row set is empty, because the row was dropped on load, or because the column is absent. The fixture (`seedDsWithDataIncludingNullScore`, a separate seed rather than a mutation of the 2-row `seedDsWithData` that dozens of other tests depend on) genuinely carries the null operand through to the output DataType.

#### Independent re-verification of the proof/guard split

I repeated cycle 1's method against un-fixed `main`: a detached throwaway worktree at `82026d58` with only `backend/src/test` from `fae992de` checked into it (`ExpressionEvaluatorSpec` reverted, since its block cannot compile without `parseProblem`), then the four affected suites.

Result: `Tests: succeeded 139, failed 7`. **The same 7 behavioural reds as cycle 1, and no others** — companion rejection (2.1), run-surface required-config (3.1), analyze (3.5a), the materialised run failure (3.1/3.2), preview (3.5b), POST 422 (2.2), PATCH 422 (2.6). The succeeded count rose 138 → 139, exactly the one new test, which is **GREEN on un-fixed `main`**.

So the count did not drift upward without reds behind it: the new test adds a guard, not a proof, and the executor labelled it GUARD in both the test comment and `files-modified.md`, stating plainly that AC3's behaviour "was never broken — only the STATIC parse case above was". That is the correct call and matches my measurement.

Both cycle-1 corrections were adopted verbatim and honestly:
- Task 1.2 is now labelled "PROOF … of the WEAK/compile-only form", says the red was a compile failure rather than a behavioural one, and names where the behavioural red for that same expression actually lives.
- The PATCH-update test was relabelled up from GUARD to PROOF, with the reason recorded ("genuinely red on unmodified `main`, not mutation-only"). My red run confirms it is red there.

Final split as I can reproduce it: **7 behavioural proofs** (one of which, 2.6, was under-claimed in cycle 1 and is now correct), **1 compile-only proof** (1.2, labelled as such), and the guard set — all confirmed green on un-fixed `main` and each failable by a stated mutation.

Code quality of the new test itself is fine: it reuses the spec's established `seedPipeline` / `outputDataTypeId` / `listRows` idiom, adds a narrowly-scoped fixture with a comment explaining why it is separate rather than a mutation of the shared one, and uses exact `shouldBe` matchers rather than loose substring checks. No dead code, no over-engineering.

### Phase 3: UI Review — N/A

Stated explicitly rather than silently skipped. The cycle-2 diff touches only `backend/src/test/**` and `openspec/changes/reject-static-compute-expression/**`. No Phase-3 trigger matches — no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`. The whole change remains backend-only. No dev server was started and none was required.

### Overall: PASS

### Change Requests

None. Cycle 1's Change Request 1 is discharged.

### Non-blocking Suggestions

- (Carried from cycle 1, still optional and still not blocking.) The task-1.3 agreement guard's expression set contains no function-call case. I re-confirmed in cycle 1 that no divergence exists — `foo($a)` yields `Some('foo' is not a recognized function)` from `parseProblem` and the matching `Left(ParseError(...))` from `evaluate`, because function-name checking happens during parse. Adding that one entry would pin the single arm (`evalExpr`'s `Unknown function` → `ParseError`, ExpressionEvaluator.scala:643) that could make the two drift if function-name validation ever moved out of the parser. Cheap insurance on the change's one identified drift risk; safe to ship without it.

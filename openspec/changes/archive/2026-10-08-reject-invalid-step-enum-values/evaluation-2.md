## Evaluation Report — Cycle 2 (evaluation-2.md)

- **Reviewed HEAD:** `bf65f66f369f936a2e3456c9cf83bb535d950a62`.
- **Diff base:** resolved live as `3d63a1751bcfd09595943ce390f8f10678e44e49`.
- **Cycle-2 delta:** commit `bf65f66f` (diff `11fcd561..HEAD`). It touches only backend files plus `files-modified.md`. `git diff --quiet 11fcd561 HEAD -- frontend` returns 0, so the frontend is byte-identical to the code reviewed in cycle 1.

### Phase 1: Spec Review — PASS

- **evaluation-1 CR1 (task 3.4 coverage): resolved.**
  - `PatchSetPipelineCreateStepConfigSpec` adds one invalid case per kind on the `pipeline`/`create` edit: fillnull `average`, window `lag` with offset 0, pivot `median`. Each case runs through both `applyService.apply` and `previewService.preview`. It asserts a 422, a message starting `edit 0: Step 's1': ` that contains the rule text, and that no pipeline with that name exists.
  - `PatchSetApplyServiceSpec`'s step-update block now loops over fillnull, window and pivot. For each kind it creates a valid step, then patches it with an invalid enum and expects a 422.
  - Task 3.4's [x] is now accurate.
- **evaluation-1 CR2 (design D1, one shared rule per kind): resolved.** The second check in each place is now limited to the empty draft:
  - `FillNullStep.apply` uses `cfg.strategy.isEmpty`, `PivotStep.apply` uses `cfg.agg.isEmpty`, and `WindowStep.apply` uses `cfg.function.isEmpty`.
  - `PipelineAnalyzeService.validateFillNull` reports `strategyProblem`, then falls back to the draft message only when the strategy is empty.
  - `validatePivot` reports the draft message when `agg` is empty, else `aggProblem`.
  - `validateWindow` reports the draft message when `function` is empty, else `fieldProblem ++ enumProblems`.
  - Each `*Problem` function is now the only place a non-empty unknown value is rejected.
  - **It is now load-bearing.** The `cfg.strategy match` in `FillNullStep.apply` has no default case (it never did), so if `strategyProblem` were weakened, an unknown strategy would raise a `MatchError` instead of a `StepConfigError`. That breaks `StepEnumWriteValidationSpec`'s `intercept[StepConfigError]` apply test. Weakening it would also make analyze report nothing for `average`, which breaks the "exactly once" analyze test. I traced this through the code; I did not run a mutation.
- The cycle-1 non-blocking suggestion was also adopted: the window `validateRawConfig` override now uses `enumProblems(_).headOption` instead of the `mkString("; ")` join.
- No new scope. AC coverage, the read-only helio-news check, legacy read/analyze, and constraint C1 are as recorded in evaluation-1.md and unaffected by this delta.

### Phase 2: Code Review — PASS

Gates, run fresh by me in WORKTREE_PATH on `bf65f66f`:
- `cd backend && nice -n 19 sbt testFull`: **6344 succeeded, 0 failed, 4 canceled** (the HELIO_MEASURE report-only perf tests), plus `All tests passed`. That is one more test than cycle 1, which is the new pipeline-create spec case. All HEL-1416 cases appear in the log as passing, including the new PatchSetPipelineCreateStepConfigSpec and per-kind step-update cases. `CreateStepConfigNonRegressionSpec` is green.
- `npm run lint`: clean, 0 warnings.
- `npm run format:check`: clean.
- `npm test`: 477 suites and 5023 tests passed, plus helio-mcp's 42 suites and 407 tests.
- `npm --prefix frontend run build`: OK.

Code: the delta is small and correct. Behavior is the same as cycle 1 for every case: non-empty unknown values are rejected, empty drafts are reported by analyze and refused at run, and an unknown window function now skips the field check. The comments now describe the code accurately. No dead code, no new imports, no type escapes.

### Phase 3: UI Review — PASS

- The frontend is byte-identical to `11fcd561`, which passed the full live UI review in cycle 1. That review covered the 422 surfacing in all three editors, keyboard use, the breakpoints, and the console. Screenshot evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1416/evidence/eval-hel1416-fillnull-422.png`.
- The cycle-2 backend delta changes no response status or message for any write surface, and its tests cover it. So the observable UI contract is unchanged.
- I did not restart the dev servers this cycle.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- The comment above `validatePivot` (`PipelineAnalyzeService.scala`, around line 445) still reads "one shared rule; the empty-agg draft is still reported", while the other two validators now say "reported here". Purely cosmetic.

### Evaluator side effects
No new dev-DB residue this cycle. The cycle-1 residue is listed by exact id in evaluation-1.md.

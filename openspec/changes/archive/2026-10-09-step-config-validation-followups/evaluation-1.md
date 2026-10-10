## Evaluation Report — Cycle 1 (evaluation-1.md)

- Reviewed HEAD: 7a28e1f53e86df56162819692c65555175fbf558
- Base, resolved live: c804b4296fe7b9a355dc0e00e51ca404dea0800e
- Spawn guard: READY

### Phase 1: Spec Review — PASS
Issues: none.

- **AC1.** `PatchSetApplyResolvers.scala:732-745` (`resolvePipelineStepCreate`) runs the strict check after decode and authorization and before `authorizeSecondSourceForCreate`. A rejected config returns `UnprocessableEntity(s"edit $index: $msg")`, the same shape as the update edit (l.204-206).
  - Apply and preview both resolve through `resolveAll`, so both return 422 and nothing is applied.
  - The new `PatchSetStepCreateConfigRoutesSpec` covers this through the real `PatchSetRoutes` apply and preview routes: a two-edit set where the earlier rename is not applied and no step is created, plus a valid-config control.
  - **I reproduced the red myself.** I made a throwaway detached worktree at c804b4296 (the pre-fix main tree) and added only the new spec. Result: `apply: 200 OK was not equal to 422`, `preview: 200 OK was not equal to 422`, 1 passed / 2 failed. The scratch worktree has since been removed.
- **AC2.** `git grep` finds 7 `rawConfigProblem` uses in `backend/src/main`: the 6 original sites plus the new step-create site.
  - The only remaining direct `validateRawConfig` lookup is `StepConfigValidation.scala:49`. Design D2 excludes it deliberately, and AC2 counts exactly 6 sites.
  - At every site the surrounding wrapping is unchanged: bare msg, `edit N:`, `Step 'id':`, `step N:`.
  - At `PipelineService.scala:1857` the evaluation order relative to the `PipelineStepKind.All` check is unchanged. The helper is a pure expression, so this is a byte-equivalent lookup.
- **AC3.** `ColumnSchemaInference.scala:55-56`: an absent or null `type` gives no hint, and the fallback type is `string`. `column`/`expression` stay required inside the `try`, so a genuinely malformed config is still reported generically.
  - **I reproduced this red too.** `ComputeOptionalTypeAnalyzeSpec` on the pre-fix tree: 3 failed (no-type valid, null type, unknown field) and 3 passed (with-type guards and missing-key generic). That matches the executor's claim.
- **AC4.** `PipelineCreateStepConfigRoutesSpec.scala:145` now asserts `include("Step 'agg':") and include("bogus")`. The main spec's Purpose is widened. The HEL-1416 surface list now includes patch-set step-create, which was the skeptic's non-blocking note.
- **AC5.** The split is filed as HEL-1463, per the ticket's own allowance (D5).
- Tasks 1.1–3.5 are all marked done and match the diff. There is no scope creep, and no wire-shape change beyond the 422 status on an edit kind whose siblings already return it.
- `openspec validate --specs`: 467 passed / 0 failed. The change itself validates.
- `CONSTRAINTS: []`, so there is nothing further to honor.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH (backend-only diff, no `frontend/**` files):

- `nice -n 19 sbt -J-Xmx3g testFull`: **6498 succeeded, 0 failed, 4 canceled, 0 ignored**, exit 0, 486 s.
  - The 4 canceled are the env-gated report-only measurement tests (`HELIO_MEASURE=1` / the "500 ms median" probe). They are canceled on every run and are not failures.
  - The new specs ran: `PatchSetStepCreateConfigRoutesSpec` and `ComputeOptionalTypeAnalyzeSpec` both appear in the log.
  - The executor's earlier run was 6496 passed + 2 failed. The total is now 6498, all passing, which closes the gap left by not re-running the full suite after the test edits.
  - The known CI flakes HEL-1439 and HEL-1445 did not appear locally.
- `npm run check:scala-quality`: clean (soft-size warnings only, all pre-existing).

Points the orchestrator asked me to scrutinise:

- **PatchSetApplyServiceSpec edits (HEL-1310 l.556-560, HEL-1416 l.586-592).** These are the AC1 contract change, not a fixture edit hiding a defect.
  - Old assertion: a 200 response carrying `failure` that includes the message.
  - New assertion: `Left(UnprocessableEntity)` whose message `startWith("edit 0: ")` and includes the same fragment (`requires 'p'` / the enum message). The new assertion is strictly tighter.
  - The "no step created" assertions are kept.
  - Both cases' update-edit assertions are byte-identical to base. I compared the base file at c804b4296 l.540-600 with HEAD.
- **`"type": null` treated as absent.** This is consistent with the strict write-path decoder. `ComputeConfig.decode` uses `StepCodecUtil.strOpt`, which goes through `present()` = `obj.fields.get(key).filterNot(_ == JsNull)` (`StepCodecUtil.scala:64-65`). So the write path already accepts null as "no hint", and analyze now agrees. A non-string `type` is still 422 on write and generic in analyze, as D3 states.
- **Call sites.** Messages and statuses are byte-identical; see AC2 above.
- **Mutation 3.2/3.4.** I did not re-run these. Mutating code is out of the evaluator's remit, and the two red-first reproductions above cover the new behaviour. 3.2 is also structurally certain: every rejection path now flows through the one helper.

Other checks:

- DRY/modular: the helper is lookup-only, which is correctly scoped.
- No dead code, no TODOs, no inline FQNs.
- Ordering decision: authorization comes first, so a caller without access never gets config feedback. The config check comes before the second-source check, mirroring the update edit.
- An unknown `type` keeps its apply-time 400. This is documented in the comment and in the proposal's non-goals.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change that affects the UI.

The only `openspec/specs/**` edit is a Purpose sentence and a surface-list word in `pipeline-step-config-rejection`. These are spec prose for backend validation, with no UI surface. Task 2.1 grep found that the frontend `patchSetsSlice.ts` already surfaces non-2xx `response.data.message`, so the 422 renders through the existing error path and the frontend needs no change.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PatchSetApplyResolvers.scala` is 848 lines, up 8. It was already over the ~400-line "propose a split" threshold. HEL-1463 covers `PipelineService.scala` only, so a note in the PR body (or a follow-up ticket) for the resolvers file would match CONTRIBUTING l.24.
- `ComputeOptionalTypeAnalyzeSpec` exercises `StepSchemaInference.inferOutputSchema` rather than the analyze route. The design allows this. A route-level case would also pin the `validationError` wire field.

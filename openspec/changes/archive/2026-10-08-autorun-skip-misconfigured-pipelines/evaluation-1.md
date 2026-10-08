## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `5280482a06c10bc420fac9e4a6b38ca42cb3134f` (base `f9f38bb42f9e505751a3511a2fe9a3270382ec87`, resolved live via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (skip vs submit-and-fail): skip chosen (design D1). Denial is returned through the existing HEL-1096 `deniedPipelines` surface and logged by the same `handleDenied` path. Verified live: an append write returned `deniedPipelines[0] = {canRun:false, reasons:[{code:"step-config-invalid", detail:"compute step is missing required config value 'column'.", stepId:...}]}`. Afterwards the DB had 0 `pipeline_auto_run_debounce` rows and 0 `pipeline_runs` for that pipeline.
- AC2 (single source): `AutoRunTriggerService.scala:92` calls `PipelineAnalyzeService.stepConfigProblem`, which is a one-line delegate to the same private `validateStepConfig` that `analyzeNodes` calls (`PipelineAnalyzeService.scala:302`). It uses the same raw-config encoding as analyze: `PipelineStepConfigCodec.encode(s)` with `op = s.kind`, as in `PipelineService.scala:985-990`. No parallel check exists. The `"step-config-invalid"` literal now appears once in main code (`PipelineAnalyzeService.scala:47`). Live seam check: for the same pipeline, analyze `costVerdict.reasons` and the write-response `reasons` were byte-identical.
- AC3 (red before green): reproduced myself, not taken from the executor's report (see Phase 2).
- Scope constraints: `git diff --name-only` contains no `DatasetWriteAutoRunEndToEndSpec`, `PipelineRunGuardRepository` or `PipelineRunService` path (grep rc=1). PipelineService only swaps a private constant for the shared one.
- HEL-1280 safety: only the schema-independent class gates auto-run. The guard test exists and fails under a mutation (see Phase 2).
- Contract: `denied-pipeline-response.schema.json` enum and `canRun` description are updated. The `check-schema-drift` script passes. `openspec validate --strict` reports the change as valid. The spec delta covers the new scenarios.
- All tasks in tasks.md are checked and match the diff. `workflow-state.md` CONSTRAINTS is `[]`, so there is nothing further to honor.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (my own fresh runs in WORKTREE_PATH):
- `sbt testFull`: succeeded 6124, failed 0. The 4 canceled tests are pre-existing `HELIO_MEASURE=1` measurement specs.
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm test`: 464 suites / 4900 tests passed. `npm --prefix frontend run build`: exit 0. `npm run check:scala-quality`: clean (soft warnings only).
- `check-schema-drift`, `check-openspec-hygiene`, `check-spec-structure`: pass.

Reproduced RED (executor claim verified):
- I reverted only `AutoRunTriggerService.scala` to the base version (`git show f9f38bb42:<file>`) and ran `testOnly AutoRunTriggerServiceSpec DataSourceServiceDeniedPipelinesSpec`. Result: 4 failed / 21 succeeded.
  - The 3 new AutoRunTriggerServiceSpec cases failed: `None was not defined` (:183), `None was not equal to Some(false)` (:200), and `Vector("ai-step") was not equal to Vector("ai-step","step-config-invalid")` (:228).
  - The new DataSourceServiceDeniedPipelinesSpec wire case also failed (`None was not defined`, :158).
- The file was then restored with `git checkout --`. The tree was clean again.

Reproduced the HEL-1280 mutation (executor claim verified):
- I replaced the `stepConfigProblem` call with a full `analyzeNodes(...).validationError` gate, using the seeded dataset's stored schema `[name:string]`. The guard test "a schema-derived analyze validationError ... does NOT deny auto-run" went red: `Vector(Denied(..., CostReason("step-config-invalid","Unknown field: missing_col",...), false)) did not contain element Allowed(...)` (:251). 1 failed / 15 succeeded.
- The file was restored. The tree is clean (`git status --short` empty) and HEAD is unchanged at 5280482a0.

Code-quality checklist:
- Inline FQN rule: clean (the quality gate passes).
- DRY: the constant was moved, not duplicated. The validator is reused.
- Type safety: no escape hatches.
- Error handling: unchanged. Failures are still recovered in `evaluateOne`.
- Tests: they exercise owner, editor-grant, stranger, disabled step, combined cost+config ordering, the HEL-1280 guard (with an in-test premise check that analyze really flags the case), and the service-level wire. Each case can fail, as the red runs above showed.
- No dead code. No over-engineering.

### Phase 3: UI Review — PASS
Phase 3 was triggered by `frontend/**` (a comment-only change in `denyReasonCopy.ts`) and `schemas/**`. Because the backend change alters what an existing UI surface shows, I ran the observable checks rather than marking N/A.

- Servers came up via `start-servers.sh`. `assert-phase.sh servers` returned PASS (ports 6711/9618).
- Happy path: logged in as the dev account and created a dataset-rooted pipeline with a `compute` step whose `column` is empty. Created a form panel bound to that dataset and submitted a row from the dashboard. The Notifications region rendered "HEL-1279 eval misconfigured: A step in this pipeline is misconfigured, so it can't run until that step is fixed." Its only button was "Dismiss notification", so no "Run to update" control was offered (`canRun:false`). This is DOM-text evidence captured via `browser_evaluate`; no screenshot artifact was needed.
- Console: 0 errors and 0 warnings during the flow.
- Entry points: the form panel is the only frontend consumer of `deniedPipelines` (`FormPanelView.tsx`). The source page's rows grid "Add row" does not surface denials. That is pre-existing behaviour, unchanged by this diff and outside its scope.
- Breakpoints and accessibility: no markup or style changed (the frontend diff is a comment only), so there is no new layout surface to resize-check. The existing toast has an accessible dismiss name.
- Test data (dashboard, pipeline, dataset) was deleted afterwards (204 ×3).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `AutoRunTriggerServiceSpec.scala:5`: the import selector `{AnalyzeWithAiConfig, ComputeConfig, AnalyzeWithAiOutputField, ...}` is not alphabetized. A blank line was also added before `import spray.json._` (lines 17-18). This is cosmetic.
- `PipelineAnalyzeProtocol.scala:237` and `AutoRunTriggerService.scala:116-117`: the edited doc lines now run well past the surrounding comment width. Consider re-wrapping them.
- Spec delta wording ("the same reasons and ordering analyze reports") holds only for the schema-independent class. Analyze can additionally report schema-derived `step-config-invalid` reasons that auto-run deliberately omits (D2). Consider "the same config-class reasons" for precision.
- `PipelineAnalyzeService.scala` (1191 lines) is far over the 250-line soft budget. The change adds +10 lines to an already over-budget file. A split proposal in the PR description would satisfy CONTRIBUTING's ~400-line guidance.
- Environment note, not a code issue: the Playwright MCP wrote its snapshot/console files to `/home/matt/Development/helio/.playwright-mcp/` (the main checkout), which is the known shared-browser hazard.

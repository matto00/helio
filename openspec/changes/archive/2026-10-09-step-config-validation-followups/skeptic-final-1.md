## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 7a28e1f53e86df56162819692c65555175fbf558. Base resolved live with `resolve-review-base.sh`: c804b4296fe7b9a355dc0e00e51ca404dea0800e. Spawn guard: READY.

### What I verified (with evidence)

- **AC1 (resolve-time 422 on apply and preview).** In `PatchSetApplyResolvers.scala` `resolvePipelineStepCreate` (around l.729-745), `PipelineStep.rawConfigProblem(request.type, request.config.compactPrint)` runs after the pipeline is authorized and the patch is decoded, and before `authorizeSecondSourceForCreate`. On a rejection it returns `UnprocessableEntity(s"edit $index: $msg")`, the same shape the update edit returns at l.204-206.
  - Apply and preview share the resolve path, so the patch set is refused before any edit is applied.
  - `PatchSetStepCreateConfigRoutesSpec` covers this through the real `PatchSetRoutes` `/patch-sets/apply` and `/patch-sets/preview` routes. It checks the 422, the `edit 1: ` prefix and `nosuchfn`. On apply it also checks that the earlier rename edit was not applied and that the step count stays 0. A valid-config control case is included.
  - An unknown `type` produces no problem from the helper, so it keeps its existing apply-time 400.
- **AC2 (six sites through one helper).** `rawConfigProblem` (`PipelineStep.scala:277-281`) is exactly `companionFor(kind).toOption.flatMap(_.validateRawConfig(raw))`, so it is a pure, byte-equivalent lookup.
  - In the diff, all 6 former inline sites now call it: PatchSetApplyResolvers l.204 and l.576, PipelineProposalService l.295, and PipelineService l.561, l.1857 and l.2211. Each keeps its surrounding wrapper unchanged (bare msg, `edit N:`, `Step 'id':`, `step N:`).
  - A grep of `backend/src/main` finds no remaining `companionFor(..).toOption.flatMap(_.validateRawConfig` sites. The only other `validateRawConfig` caller is `StepConfigValidation.scala:49`, the analyze hook, which is a different pattern and is excluded by design D2.
- **AC3 (compute `type` optional in analyze).** In `ColumnSchemaInference.scala:53-56`, `type` is now `fields.get("type").filter(_ != JsNull)`, and the hint defaults to `string`. `column` and `expression` are still read with `fields(...)` inside the `try`, so a missing key still gives the generic `compute config error`. The test checks this case.
  - Treating null as absent matches the write path: `ComputeConfig.decode` uses `StepCodecUtil.strOpt`, which goes through `present()` and treats JsNull as absent.
- **AC4.** `PipelineCreateStepConfigRoutesSpec.scala:145` asserts `include("Step 'agg':") and include("bogus")`. The `pipeline-step-config-rejection` Purpose now names parse-but-invalid configs and every write surface, including patch-set step-create. The HEL-1416 surface list is updated to match.
- **AC5.** I checked HEL-1463 in Linear: "Split PipelineService.scala (~2650 lines) behaviour-preserving", status Backlog. It states the same proof standard as the earlier splits, and the reasoning for keeping it separate is sound: a byte-move proof needs a diff that changes no behaviour.
- **Gates, re-run by me.** `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.patchsets.* com.helio.services.patchsets.* com.helio.domain.engine.ComputeOptionalTypeAnalyzeSpec com.helio.api.routes.pipelines.PipelineCreateStepConfigRoutesSpec com.helio.domain.engine.*Analyze*"` gave `Tests: succeeded 362, failed 0` and `All tests passed.`
  - I relied on the evaluator's pasted full `testFull` output (6498 succeeded / 0 failed / 4 env-gated canceled) and its red-first reproductions (apply and preview `200 OK was not equal to 422`; compute 3/6 red on the pre-fix tree). The output is pasted and specific, and the red outcomes follow structurally from the base code: the base resolver had no check, and the base code used `json.fields("type")`, which throws on an absent key.
- **No UI change.** There are no `frontend/**` files in the diff. The 422 message reaches the UI through the existing non-2xx `response.data.message` path in `patchSetsSlice.ts`. Step 4 does not apply.

### Judgments requested by the orchestrator

- **PatchSetApplyServiceSpec 200+failure → 422 edits.** This is the intended contract change. AC1 explicitly asks for the forward-apply `failure` report to become a resolve-time 422. The new assertions are stricter than the old ones: they pin the status, the `edit 0: ` prefix and the same message fragments. The "no step created" assertions are kept, and the update-edit halves of both tests are unchanged.
  - I searched `openspec/specs` for any spec text that promises a 200 + failure for a step-create config rejection and found none. The change's spec delta adds the new 422 requirement explicitly, so the contract is documented rather than drifting.
- **AC3 test is function-level, not route-level.** This does not leave the wiring unproven in any way that matters. `PipelineAnalyzeService.analyze`/tree-analyze call `validateStepConfig`, then `inferOutputSchema`, then `StepSchemaInference` (`case "compute" => inferCompute`, l.44), and place the returned `err` directly in `AnalyzedStep.validationError`. That wiring is unchanged by this diff and is already covered at route level by `PipelineAnalyzeRoutesSpec` and its siblings.
  - I also checked that `validateStepConfig` does not intercept a compute config with no `type`. `ComputeStep.requiredConfigProblems` requires only `column` and `expression`, `validateRawConfig` strict-decodes `type` as `strOpt`, and the per-kind match falls to `Vector.empty` for compute.
  - The only code that changed is the leaf, and the leaf is what the new spec tests. A route-level case would be nice to have but is not required.

### Verdict: CONFIRM

### Non-blocking notes
- `PatchSetApplyResolvers.scala` is about 848 lines, already over the ~400-line split threshold. HEL-1463 covers only `PipelineService.scala`, so mention it in the PR body or file a sibling follow-up.
- Optional: add a route-level analyze case for a compute step with no `type` to pin the `validationError` wire field end to end.

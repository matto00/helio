## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `892985c86799c167e99610d3e2464f8c4366e8ca`. Review base (live, `resolve-review-base.sh ... main origin`): `2dd4ed6237817b1feef22d69f8bc8058e58541db`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/validate-create-step-configs/HEL-1402`.

### What I verified (with evidence)

**Diff (ground truth).** There are two main-source hunks and no other production change:
- `PipelineService.buildStepsAction` (L557-566) runs `companionFor(type).validateRawConfig` after the duplicate, type and parent checks and before `PipelineStepConfigCodec.decode`. On failure it raises `PipelineCreateValidationFailure(UnprocessableEntity("Step '<clientId>': <msg>"))` inside the transaction.
- `PatchSetApplyResolvers.resolvePipelineCreate` (L573-585) does the same check after the roots pre-check and returns `Left(UnprocessableEntity("edit N: Step '<clientId>': <msg>"))`.

The test-only changes are three new specs plus one pin added to `PipelineApplyProposalSpec`. No existing fixture was edited, so C6 holds.

**AC1 (4xx naming the function and the supported list, on every write path; 400 corrected to 422).**
- Single-call create: `PipelineCreateStepConfigRoutesSpec` L113-124 asserts 422, `calc`, `nosuchfn` and "supported functions", and that nothing is persisted.
- Step add/update already use the identical validator. I read `PipelineService.scala` L1839-1846 (`addStepReporting`) and L2192-2197 (`updateStep`). Both call the same `companionFor(...).validateRawConfig` and return 422. Compute's override (`ComputeStep.scala` L99-104) is what produces the function message, so all surfaces emit the same text.
- Proposal apply: `PipelineProposalService.validateSteps` L290-296 already rejects. The new pin is at `PipelineApplyProposalSpec` L167-179.
- Patch-set create edit: new, red-first (see C3 below).
- `ServiceResponse.scala` L102 maps `UnprocessableEntity` to HTTP 422, and `PatchSetRoutes` apply/preview run through `ServiceResponse.run`. The service-level `Left` therefore reaches the client as a real 422.
- 422 instead of the ticket's 400 is documented in ticket.md and design D2. It matches `pipeline-step-config-rejection`.

**AC2 (every kind on single-call create).** The check is keyed on `PipelineStep.companionFor(spec.type)`, so it covers every registered kind. The cast case (`casts` array) and the aggregate case (bogus `fn`) are tested at L127-148.

**AC3 (legacy read/analyze unaffected).** No read or analyze code is touched. The test at L174-193 inserts the step through `stepRepo.insertInternal`, then gets 200 with 1 step from list and 200 with `step-config-invalid` from analyze.

**AC4 / C4 (helio-news, read-only).** I grepped `/home/matt/Development/helio-news` myself and made no writes. Its only `create_pipeline` calls that carry steps are:
- `news/projects/build.py` L85-88: filter + aggregate count
- `news/enrichers/series.py` L77-83: aggregate avg with object `groupBy` + sort
- `news/enrichers/__init__.py` L65: select

All of them go through `_chain` in `helio_client.py`. Each is pinned literally in `CreateStepConfigNonRegressionSpec` L20-34; the select uses a sample of a dynamic field list. The shape pipelines (`build_shape_pipeline`, `helio_client.py` L256-265) create a bare pipeline with no steps and then call `add_outputs_from_shape`, so the change never reaches them. The frontend `createPipeline` (`pipelineService.ts` L51) sends no steps, so there is no UI impact.

**C3 (red-first per newly validated path).** I ran my own mutations in a throwaway detached worktree under the session scratchpad and removed it afterwards (`git worktree list | grep -c scratchpad` → 0):
- Mutation A, reverting only the `PipelineService.scala` hunk to base: the 3 single-call create tests fail with `201 Created was not equal to 422` (L118), `400 Bad Request was not equal to 422` (L131) and `201 Created was not equal to 422` (L144). The other 17 tests pass, including the proposal pin, which correctly shows it is a regression pin and not a red-first test.
- Mutation B, reverting only the `PatchSetApplyResolvers.scala` hunk: apply returns `Right(PatchSetApplyResponse(... rolledBack ..., Some(Step 'calc': compute: invalid expression: 'nosuchfn' is not a recognized function; supported functions: abs, ceil, ...)))`, i.e. 200 with `failure` (L138). Preview returns `Right(PatchSetPreviewResponse(...))` (L148). Both tests fail and the other 7 pass.

**C1 (gates).**
- Fresh run in the review worktree: `nice -n 19 sbt "testOnly <the 4 specs>"` → 27 run, 27 succeeded, EXIT=0.
- Fresh run: `nice -n 19 sbt testFull` → `Total number of tests run: 6252 ... succeeded 6252, failed 0, canceled 4`, EXIT=0 (log: `scratchpad/hel1402-skeptic-testfull.log`). The 4 canceled are the pre-existing report-only perf probes, matching the evaluator's count.
- I never used bare `sbt test`.

**C2 / C5.** I used no pkill/pgrep. There is no dev DB or Playwright use, because the change is backend-only (no `frontend/**` in the diff), so the UI judgment step is N/A. The only write outside the worktree was the scratchpad mutation worktree, which has been removed.

**Message consistency.** The `Step '<clientId>':` prefix matches `buildStepsAction`'s existing messages. The patch-set `edit N: Step '...'` prefix matches the existing `edit N:` convention.

### Verdict: CONFIRM

### Non-blocking notes
- `PipelineCreateStepConfigRoutesSpec.scala:145`: `include("agg")` is weak because it also matches "aggregate"/"aggregations". Prefer `include("Step 'agg':")` and `include("bogus")`.
- Patch-set **pipelineStep create** edits still fail only at forward apply (200 + `failure`, rolled back), not at resolve time. This is an explicit design non-goal and a follow-up candidate.
- There is no step-route test that uses an *unknown-function* expression specifically (the HEL-888 tests use unparseable literals). Behaviour is covered because the validator is shared, but a one-line pin would make AC1's step-route leg literal.
- Client-visible status change: on single-call create, a wrong-shape `cast` moves from 400 to 422. Note this in the PR body.
- The `companionFor(...).toOption.flatMap(_.validateRawConfig(...))` idiom now appears at 6 sites. A shared helper would be a reasonable small follow-up.

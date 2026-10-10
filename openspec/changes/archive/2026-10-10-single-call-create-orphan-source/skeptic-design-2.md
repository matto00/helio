## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 625e1deff20f2ba73e98b2cfa0a1d0d1e298e25a. The planning artifacts are untracked under the change dir. I reviewed them cold against the live source.

### What I verified (with evidence)

- **The round-1 CRs are addressed in the text:**
  - CR1, lane ordering: design.md "Lane-check ordering (C4)" and task 1.1a.
  - CR2, failed-Future proof: Decision 2 "Failed Futures" and task 1.1b.
  - CR3, simple-path multi-root case is mandatory: task 1.1 cases (a) and (b), plus the spec scenario "A simple-create request whose later root is unknown".
  - CR4, same-family leaks:
    - (a) is fixed by Decision 3a and task 1.3/2.5.
    - (b) and (c) are explicit Non-Goals with follow-up candidates.
  - CR5, HEL-906 ruling and docstrings: the "Relation to the HEL-906 ruling" paragraph and task 2.6.
- **The lane-pass design matches the live code.**
  - `validateStepCrossOwnerRefs` (PipelineService.scala:410-472) decodes each step and skips lane checks on decode `Failure` (line 451).
  - It runs `validateLane` (self 400, not-in-request 422, ancestor 400) for each step before `buildStepsAction`'s forward-reference 400 (589-595).
  - Design pass 1 (lane checks over all steps) followed by pass 2 (per-step `buildStepsAction`-shaped checks) preserves the single-class outcomes.
  - The per-step order in `buildStepsAction` is pure throughout: duplicate, then type, then parent, then `rawConfigProblem`, then decode, then forward-lane (525-605).
  - The Output checks that run before `validateOutputFieldMapping`'s fieldMapping part are also pure: `nodeStepClientId` against all step clientIds, name, `OutputKind`, and `OutputConfigValidation`/`OutputCompare`/`PayloadOptIn` (614-694). The pre-flight split is therefore feasible exactly as described.
- **Root messages are consistent.** The simple path's `pipelineRepo.create` 404 text is `Data source not found: <id>` (PipelineRepository.scala:327), the same text as the transactional `findByIdOwned` path (PipelineService.scala:226). A read-only pass (a) can therefore preserve the message on both paths.
- **Decision 3a is implementable.**
  - The forward outcome carries `resultingState = pipelineSummaryResponseFormat.write(summary)` (PatchSetApplyForward.scala:86-89).
  - `PipelineSummaryResponse.roots` is in position order (PipelineProtocol.scala:86-91).
  - `createAction` assigns `position` by request index (PipelineRepository.scala:422-424).
  - `ResolvedAction.PipelineCreate(request)` keeps the request (PatchSetApplyTypes.scala:56), so inline-vs-existing can be read by index.
  - `services.dataSourceService` is already used by the `DataSourceCreate` rollback branch (PatchSetApplyRollback.scala:107-118).
  - `DataSourceService.delete` (DataSourceService.scala:649-662) refuses with 409 while references exist. After the pipeline delete the source has no root reference, so the delete is reachable, and the 409 stays a safety backstop.
- **The patch-set status today, ground truth.**
  - `resolvePipelineCreate` (PatchSetApplyResolvers.scala:537-584) pre-checks only roots plus `rawConfigProblem`.
  - An unknown step type or a bad Output config therefore reaches `PatchSetApplyForward`. `pipelineService.create` returns `Left`, then `applyResolved` → `rollback`, which returns **`Right(PatchSetApplyResponse(failure = Some(msg)))`**, i.e. HTTP 200 (PatchSetApplyService.scala:111-129).
  - `PatchSetPreviewService` (line 44) shares `resolveAll`. Today a preview of the same edit passes resolve and projects through `pipelineCreateAfter` (PatchSetPreviewProjection.scala:103-104).
- **Failed-Future coverage (task 1.1b) is feasible.** `PipelineService` uses its own `dataSourceRepo` for the `findByIdOwned` re-lookup and the `resolveSecondarySourceSchemas` lookup, while `DataSourceService` (used for inline creation and the compensating delete) has its own repo. A stubbed `PipelineService` repo can throw post-creation while creation and delete stay real.

### Verdict: REFUTE

Both change requests below are text-only edits to the artifacts. The design's mechanics are sound.

### Change Requests

1. **C4 contradicts Decision 3 and its own spec scenario, and the preview surface goes unmentioned.**
   - tasks.md C4 says "No status code or message of an existing failure class changes". proposal.md says "status codes per failure class are unchanged". design.md Non-Goals says "Changing any status code or error message of an existing failure class".
   - But Decision 3 plus the scenario "A patch-set pipeline create with a bad step type or Output config is refused before apply" deliberately change an existing class on the patch-set surface:
     - A pipeline-create edit with an unknown step type, a bad Output config, an unresolvable `parentStepId`, an undecodable config or a duplicate clientId today returns **HTTP 200** with `failure: "<msg>"` and earlier edits rolled back (PatchSetApplyService.scala:126-129).
     - After the change it returns a resolve-time **4xx** with an `edit N: ` prefix, and nothing is applied.
     - Because `PatchSetPreviewService` shares `resolveAll`, preview of such an edit also changes, from a 200 projection to a 4xx. No artifact mentions preview.
   - The change is defensible: it follows the HEL-1402/HEL-1417 precedent this file already follows for `rawConfigProblem`. But as written, an executor or evaluator applying C4 literally would treat Decision 3 as a violation, or would skip it.
   - **Required:**
     - Narrow C4, the proposal bullet and the Non-Goal to the direct `POST /api/pipelines` route.
     - Add an explicit statement in Decision 3 (and a proposal bullet) that on the patch-set apply AND preview surfaces these classes move from 200-with-`failure` (apply) or a projected preview to a resolve-time 4xx with the `edit N: ` prefix, citing the HEL-1402 precedent.
     - Extend task 1.2 or 2.4 to assert the preview refusal too, as the existing `PatchSetPipelineCreateStepConfigSpec` does for HEL-1402.

2. **The order of the pre-flight relative to root pass (a) is unspecified, and the Risks section makes a claim that depends on it.**
   - Decision 1 says only "(b) only after (a), the pre-flight, and `validateStepCrossOwnerRefs` pass". Task 2.1 says "call it in `create` before any root resolution that writes". Both orderings fit that text.
   - Risks claims "root shape/ownership errors still precede step errors". That is true only if pass (a) (existing-`sourceId` ownership, read-only) runs BEFORE the step/Output portion of the pre-flight. Today `resolveRootDataSources` (PipelineService.scala:213-231) runs before every step check.
   - If the pre-flight runs first, then a request with an unknown root `sourceId` (404) plus a refused step config (422) flips from 404 to 422, contradicting the Risks text.
   - **Required:** state the exact sequence in design.md (and mirror it in task 2.1/2.2), e.g.:
     1. Pure root shape and inline-spec checks.
     2. Pass (a), the existing-`sourceId` ownership check.
     3. Step/Output root indices.
     4. Lane pass 1.
     5. Per-step pass 2.
     6. Outputs.
     7. The ownership half of `validateStepCrossOwnerRefs`.
     8. Pass (b), inline creation.

     Alternatively, choose a different order and correct the Risks sentence to match.

### Non-blocking notes

- tasks.md lists 1.3 (a red test) inside section 2, after 2.3. C2 already requires red on the whole pre-fix tree, so this is only cosmetic. Moving it to section 1 avoids an executor measuring it "red" against a half-fixed tree.
- The new lane-pass-before-ownership split moves today's per-step interleaving to all-lanes-first. Today, step 0's unowned join source (404) wins over step 1's nonexistent lane reference (422); after the change the 422 wins. This is multi-error precedence only; the existing Risks bullet could name it alongside the 404/422 example.
- Decision 3a: say what happens when the pipeline delete itself fails (the existing branch returns `unrecoverable`, and no source delete should be attempted, because it would 409 anyway). The text implies this ("After the pipeline delete succeeds") but does not state it.
- Task 1.1b: `resolveSecondarySourceSchemas` only calls `findByIdInternal` for a step with a source-kind secondary input (join/union/lookup), so the stub case needs such a step. Otherwise the "throws" branch is never reached and the test proves nothing.

## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD e0443c24d0c02b41cdda105a410cea0b6bdf2b33 (branch feature/draft-outputs-and-shapes/HEL-1733). I checked every
claim against live source. Owner rulings Q1 (`inline-confirm-then-save-dialog`) and Q2 (`one-pr`) are fixed. I do not
judge one PR infeasible: every item below is a specification gap, not a size problem.

### Round-3 change requests, re-verified against code

- **CR-1 (D5, typed schema): mostly answered.** `POST /api/pipelines/analyze-proposal`
  (`PipelineRoutes.scala:48-53` -> `PipelineProposalAnalyze.analyzeProposal`, `PipelineProposalAnalyze.scala:52-100`) runs
  the same `PipelineAnalyzeService.analyzeNodes` as the saved capabilities path (`PipelineNodeReads.scala:188-230`). So the
  projection is the server's own, not an inference.
  - **Can it express a draft? Yes.**
    - A root is `{sourceId, clientId}` (`PipelineProposalProtocol.scala:22-34`).
    - A step is `{clientId, type, config, parentStepId, enabled, rootClientId}` (`PipelineProtocol.scala:32-39`).
    - Lane references resolve by node id through `laneDependencyOf` over the same `steps`
      (`PipelineAnalyzeService.scala:236-246, 306-308`).
    - `analyzeProposal` runs only `validateStepKinds`. It does not run the create path's lane, parent or clientId checks,
      so saved step ids work as clientIds.
    - Each response step carries `s.id`, which is the clientId (`PipelineServiceSupport.scala:89-95`), so the client can
      map the response back to its nodes.
    - The client holds every input it needs: `PipelineRoot.dataSourceId` (`types/pipelineStep.ts:693-697`), and
      `Step.parentStepId`, `rootId` and `enabled` (`types/step.ts:27-49`). It also has `pipelineName`
      (`usePipelineDetailPage.ts:98`), which the request needs (see CR-2).
  - **Same projection as the saved path? Yes for enabled graphs, and it is more correct around disabled steps.**
    - Roots: both paths resolve them with `findByIdOwned`.
    - Secondaries: the proposal uses `findByIdOwned` and the saved path uses `findByIdInternal`. For the owner these agree,
      because write paths require the owner to own a join/union/lookup secondary
      (`PipelineStepOwnership.validateCrossOwnerRefs`).
    - `UpsertTargetAnalysis.overlay` changes only `validationError` (`UpsertTargetAnalysis.scala:39-43`).
    - Sibling order (`position` = array index) does not affect any schema.
    - Disabled steps: the saved path filters disabled steps out of the walk (`PipelineNodeReads.scala:211-212`). Any node
      below a disabled step is then unreachable, and `capabilities` 404s for it. The proposal keeps every step and makes a
      disabled node transparent (`PipelineAnalyzeService.scala:317-321`). It then omits disabled steps from the response
      (`PipelineProposalAnalyze.scala:82-83`). The design says nothing about disabled steps (see CR-2).
  - **Editor grantee: verified now, so the executor does not need to.** `resolveOneProposalRootSchema` calls
    `findByIdOwned`, which filters on `ownerId === caller` (`DataSourceRepository.scala:180-185`). When the caller does not
    own the root source, the whole request is a 404: "root[i]: data source not found". An editor therefore always gets
    D5's "projection unavailable" fallback.
    - For comparison, main's saved capabilities path resolves roots with the same `findByIdOwned`, but falls back to an
      EMPTY root schema (`PipelineNodeReads.scala:205-207`). An editor gets no bindable columns there today.
    - The draft fallback is therefore no worse than main.
- **CR-2 (spec): answered.** "Draft-aware Output editor" now names the server's projection of the draft, and no longer
  mentions the transport.
- **CR-3 (D15): the ordering in the effect is answered, but the trigger is not specified (CR-1 below).**
- **CR-4: answered.** Task 4.2 now matches D15 and lists tests (1)-(6).
- **Round-3 non-blocking notes: all folded in.**
  - The loading gate applies only while `hasDraft`.
  - The shape-button anchor wording is no longer circular.
  - `usePipelineDraftPresentation.ts:117` is in the D3 table.
  - Page-local "loaded" is defined, and `usePipelinePageLoad.ts:57-73` can record this mount's `fetchOutputs` result, the
    same way it already does for steps with `onStepsSettled`.

### Verdict: REFUTE

### Change Requests

1. **D15: the Output-base judgement has no trigger when Outputs load before steps-ready and nothing is dropped. A stale
   kept draft can then save over a concurrent Output change.**
   - D15 puts the judgement inside the drop/prune effect and says it runs "on the first run where outputsStatus ===
     loaded". That effect's dependencies are `[droppedNow, pipelineId, baseStepsRef]`, and its first line returns early
     on `droppedNow === 0 || staleRestoredRef.current || restoredFor.current !== pipelineId` (`usePipelineDraft.ts:97-102`).
   - `fetchPipelineSteps` and `fetchOutputs` are dispatched together (`usePipelinePageLoad.ts:64-72`), so Outputs can
     finish first.
   - In that order, the effect's run at outputs-loaded comes before the restore (`restoredFor.current !== pipelineId`).
     The restore later calls `setOverlay`, which does not change any of the effect's dependencies unless an Output op
     drops.
   - Take a kept draft whose `outputsBase` differs only because an Output was renamed on the server. No op drops, so the
     effect never runs again. The draft is never judged stale.
   - The save-time check does not catch this. It compares the fresh definition with the page's current `baseOutputs`
     (`draftSaveRequest.ts:74-81`), which already holds the server's change. A kept `outputEdits` entry for that Output
     then writes its whole name and config over the concurrent rename. That breaks the spec's "never saved over the
     change".

   Required:
   - State the judgement's trigger explicitly. It runs when BOTH the restore has run for this `pipelineId` AND
     `outputsStatus === "loaded"`, in whichever order they arrive.
     - The effect's dependencies must include `outputsStatus` and a restore marker (for example a `restoredTick` state set
       by the restore effect).
     - The judgement must sit before the `droppedNow === 0` early return.
     - If the restore effect itself judges when Outputs are already loaded, that is equally acceptable.
   - Add test (7): Outputs load BEFORE steps-ready; the kept `outputsBase` differs; no Output op drops. Expect stale.
   - Add test (8): the same order with an equal `outputsBase`. Expect not stale, judged once.

2. **D5: the analyze-proposal request and its disabled-step result are under-specified.**
   - (a) `pipelineName` is a required field. The reader raises `deserializationError("pipeline proposal 'pipelineName' is
     required")` (`PipelineProposalProtocol.scala:249-252`), so a request built exactly as D5 describes is a 400, and that
     makes every changed node "unavailable". Add `pipelineName` (the page's pipeline name; any string works) to D5's
     request shape.
   - (b) Disabled steps.
     - Send `enabled` from the draft for every step. Do not filter disabled steps out, which is the saved path's defect
       (`PipelineNodeReads.scala:211`).
     - State the result for a sheet node that is disabled in the draft. The response has no entry for it
       (`PipelineProposalAnalyze.scala:82-83`). Because a disabled node is transparent, its schema is exactly its nearest
       enabled ancestor's `outputSchema`, or its root's `sourceSchemas` entry. Either use that, or state that it falls to
       "unavailable".
     - Add one jest case for the rule you choose.
   - (c) Define "unchanged" for a node below a saved-disabled step, where `capabilities` 404s on main (see above). Either
     route such a node through analyze-proposal, or state that the 404 is handled as "unavailable". The draft sheet must
     not show a bare error where the proposal path would answer.

3. **proposal.md contradicts D5 and the spec on the point rounds 1-3 settled.**
   - "What Changes" still says the sheet's "columns and per-kind binding capabilities come from the draft frame of its
     node". D5 and the spec say the server's projection, never the frame.
   - Rewrite that bullet to match D5. The executor reads the proposal, and that line describes exactly the inference
     approach round 3 refuted.

### Non-blocking notes

- **D5 "unchanged" is transitive through lanes.** Read "a lane/secondary it reads" as "a lane node, or any of that lane
  node's ancestors". A simpler rule that is also exact: while a draft exists, use analyze-proposal for every step node and
  keep saved `capabilities` only for the root and for no-draft. The "changed" computation then cannot be wrong.
- **Rate budget.** analyze-proposal counts against the general `/api` limiter (120 per window). D5's coalescing (one in
  flight, latest wins, only while a sheet is open) keeps this well inside the limit. Mention it in Measured notes.
- **Response robustness.** `toAnalyzeStepResponse` throws, and so 500s the whole request, for a step whose config fails to
  decode and has no `validationError` (`PipelineServiceSupport.scala:120-140`). D5's "unavailable" fallback covers this
  safely, so no change is needed. A jest case with a 500 response would pin it.
- Task 7.2 still says to verify the editor case first. That check is now done (it 404s); the task can cite this report.

Verdict category: spec-divergence.

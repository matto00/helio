## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 87cf01a5f745fdd7315d21530a78a176ec83211a. The change dir is untracked and there are no code commits yet. I formed my view from the code first and read skeptic-design-1.md and skeptic-design-2.md only afterwards.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/pipeline-grantee-run-banner/HEL-1661`.
- **Analyze ground truth (`PipelineAnalyzeReads.scala`).**
  - `rootDsOpts` uses `findByIdOwned(dsId, user)` (76-77).
  - Secondaries use the privileged `findByIdInternal` (80).
  - Upsert problems are computed as the owner (81).
  - The drift baseline is owner-view through `findByIdOwnedByInternal` (99-104).
  - Cost `resolveRoot = findByIdOwned(_, user)` (144).
  - `toCostVerdictResponse` builds `step-config-invalid` from `analyzed[].validationError` (194-207).
  - The design's Context section matches the code.
- **D1, root kinds for the cost estimator.** `PipelineCostInputGathering.gather` uses `resolveRoot` for the kind, `hasSourceUrl` and the dataset row count (`PipelineCostInputGathering.scala:40-55`). The trigger passes `findByIdInternal` (`AutoRunTriggerService.scala:101`), so D1 makes the estimator inputs identical across analyze and the trigger.
- **D2, step validity from the owner's view.**
  - `checkEnabledStep` runs `validateStepConfig` before inference (`PipelineAnalyzeService.scala:32-40`).
  - `stepConfigProblem` is that same function (25-26), and the trigger gates on it (`RunConfigGate.scala:18-23`). So analyze is a superset of the trigger's config gate.
  - `AnalyzedStep` carries only schemas and `validationError` (`PipelineAnalyzeService.scala:121-129`), and `toAnalyzeStepResponse` maps each field 1:1 (`PipelineServiceSupport.scala:89+`). Taking validity from `ownerProjections` and schemas from `projections` is mechanically straightforward.
  - `findByIdOwnedByInternal` exists (`DataSourceRepository.scala:191`).
- **Grantee warnings stay quiet.** `AnalyzeSchemaWarnings` emits only from a projection known to be complete, and an empty root counts as incomplete (its header doc). Keeping `warnings` on the caller view therefore adds no spurious grantee warnings.
- **Trigger behaviour.** `computeVerdict` does not depend on the user. The user only shapes `handleDenied`'s visibility and `canRun` (`AutoRunTriggerService.scala:92-150`). D6's direct `triggerAutoRun(datasetId, editor, now)` entry point is valid.
- **Client citations.**
  - `pipelinesSlice.ts:324-338` (the file is under `state/`) keeps `analyzeResult` across a `loading` or `failed` status.
  - `selectPipelineCallerRole` is at `useSourceSampleAccess.ts:43-47`.
  - `isOwner` is at `usePipelineDirtyAndOwner.ts`.
  - `ACTIONS_HEIGHT_PROPERTY` and its `0px` fallback are at `MobilePipelineActions.tsx:16,37` and `PipelineMobile.css:268`.
  - `VIEW_ONLY_TEXT` and the recipe are at `DashboardMetaFacts.tsx:13,57-62`.
  - `OutputSheetPreviewCard.tsx:61-69` and the toast Run now (`usePipelineDraftSettle.ts:120`, wired at `usePipelineDetailSaveWiring.ts:83`) are where the design says.
- **Run-entry inventory.** I grepped `frontend/src` for `Run pipeline`, `Dry run`, `runPipeline`, `dryRun` and `Run now`, and found no run entry beyond the design's list.
  - `RunHistoryList` (`RunHistoryModal.tsx:184`) also renders the phone Runs tab, so its viewer copy covers both.
  - `usePanelDetailData`'s and `PanelContent`'s "Run pipeline" are dashboard-side.
- **`denyReasonCopy`** renders by code only (`denyReasonCopy.ts:70-72`). D3 needs no client copy change.
- **Round-2 change requests are all addressed:**
  - CR1: D4 rules 1-4 read the latest result, not the status, and the jest cases are named.
  - CR2: C9 has been reworded.
  - CR3: pipeline (e) and the `triggerAutoRun` entry point are added.
  - CR4: option (b) is taken, with "View only" in the meta line and the one-time viewer shift accepted.
  - Non-blocking items: the `flag AND amount` case (d), explicit expected values, `analyzeConcise` and the write-path detail in the PR body, the `PanelContent` audit note and the stale comments are all folded in.

### Verdict: REFUTE

D1 changes `costVerdict.estimatedRows` for a grantee from "absent" to the owner's live dataset row count on any never-run pipeline with dataset roots. The design and spec lock that in, but it breaks the binding driver constraint and the intent of Q3. Everything else is sound.

### Change Requests

1. **D1 leaks the owner's dataset row count to grantees through `estimatedRows`. This breaks the driver constraint "Nothing of the source beyond the reason code may reach a grantee" and Q3's "no … count".**
   - **How it happens.** `PipelineCostEstimator.estimateRows` (`PipelineCostEstimator.scala:138-142`) returns `lastRunRowCount` when one exists. Otherwise it returns the sum of `datasetRowCount` when every root is a dataset with a known count.
     - On main, a grantee's roots resolve to `None` through `findByIdOwned`, so a never-run pipeline gives the grantee `estimatedRows = None`.
     - After D1, the grantee receives the owner's current dataset row count.
   - **The design's justification does not cover this case.** D3 says "a grantee already sees the last run's row count (`lastRunRowCount`)". That is true only when a last run exists. In the never-run case `lastRunRowCount` is absent, so the number is new source detail.
   - **It is not just a wire field.** The client renders it: `usePipelineDetailPage.ts:235` → `StepOpEditor` / `MobileStepSheet` → `AiStepCostDisclosure` (`GenerateTextConfig.tsx:101`).
   - **It is new for viewers.** HEL-1648's sample `sourceRowCount` is served to owners and editors, never to viewers.
   - **It defeats D3.** D3 strips counts out of the reason `detail`. Sending the same count in `estimatedRows` cancels that.
   - **Required revisions:**
     - (a) **D3 / D1.** For a non-owner caller, `estimatedRows` must carry no source-derived count. Either:
       - use `summary.lastRunRowCount` (already grantee-visible) and otherwise `None`; or
       - compute it from the caller-view cost input exactly as on main.
       Reason codes and `autoRunnable` stay the owner's. If the executor or orchestrator believes the owner's value is required, raise an ESCALATION instead of deciding it.
     - (b) **Spec `pipeline-analyze-api`, the first requirement.** Remove `estimatedRows` from "SHALL equal the owner's". Add: "for a non-owner, `estimatedRows` is the pipeline's last-run row count, or absent".
     - (c) **D6.** Add an assertion on pipeline (b) or (e), with the pipeline never run. The owner's `estimatedRows` equals the dataset row count. The editor's and viewer's are absent. This must be red against a D1-only implementation. Drop "`estimatedRows` equal the owner's" from the grantee assertion list. Add a mutation that returns the owner's `estimatedRows` to grantees.
     - (d) **Risks.** Replace the "Grantee learns `estimatedRows`" bullet with the rule above.

### Non-blocking notes

- **tasks.md 3.3 contradicts D4.**
  - 3.3 says "verify … no shift of schedule chip/⋮". D4 accepts and records one shift for a viewer when the role resolves.
  - Reword 3.3 to: "no shift for owner/editor; for a viewer, at most one shift on resolve, before/after screenshots in scratch".
  - Also, tasks 1.2 and 2.2 still say "caller-view snapshot", while D6 asks for explicit literal expected values. Align the wording so the executor does not capture a snapshot.
- **The spec sentence "a viewer SHALL never see them appear and then disappear" (desktop delta) is false in one case.** If the first analyze fails, rule 4 shows the controls, and a later successful re-analyze hides them for a viewer. Qualify the sentence ("…except after an initial analyze failure, where the server stays the authority").
- **Other copy that invites a viewer to run.** `OutputSheetPreviewCard.tsx:59` ("Run the pipeline to populate it.") and `OutputHistoryModal.tsx:51` ("Run the pipeline to start recording this Output's history.") still invite a viewer to act. D4 gives `RunHistoryModal` a viewer variant on exactly that principle. Either apply the same treatment to these two or list them in the run-entry audit as deferred to the Q2 follow-up.
- **The D2 neutral sentence also replaces the upsert-target messages.** For a non-owner, D2 replaces the `UpsertTargetAnalysis` messages, which grantees receive today, with the neutral sentence. That is stricter than required and not a leak, but it is a visible change for a grantee. Mention it in the PR body.

### Product questions not settled by the ticket and rulings

- None new beyond round 2's (whether Q3 also covers the write-path `Denied` reasons, which the design names as a follow-up). CR1 is decided by the existing driver constraint and Q3, so no new question is needed. If the planner wants grantees to keep the owner's `estimatedRows`, that is the escalation point.

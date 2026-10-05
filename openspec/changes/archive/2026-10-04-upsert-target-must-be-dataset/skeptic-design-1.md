## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence, live tree eda4669e)
- Chokepoint: `UpsertSourceConfig.validateTargetOwnership` (UpsertSourceConfig.scala:260) only does findByIdOwned; called via `upsertOwnershipCheckF` (PipelineService.scala:1923) from create (:470), addStep (:1898/:1907), updateStep (:2185). Other step inserts (:589 buildStepsAction, :1978-2081 spliceInsert) are downstream of those checks. Patch-set apply forward calls pipelineService.create/addStep/updateStep (PatchSetApplyForward.scala:87-99) with compensating rollback; its resolver pre-flight (PatchSetApplyResolvers.scala:217) only covers secondaryDataSourceId, never upsert targets, so D9's "no parity hunk needed" is correct. No pipeline import (only dashboard import). Claim holds.
- Only kind check is DataSourceRepository.scala:390-393 (`kind != Dataset && != Static`); `canonicalize` maps static->dataset (DataSource.scala:284), so D1 is behaviour-identical.
- UpsertSourceStep.evaluate (UpsertSourceStep.scala:30) only records a PendingWrite: confirms why analyze/preview/dry run miss it. Marker wiring: StepConfigError (StepCodecUtil:11), isStepConfigError (InProcessPipelineEngine:44), logExecutionFailure/executionFailureError (PipelineRunService:103-120) apply to any evaluate failure; ownerUserId passed at all five sites (:529,614,742,759,1074). Evaluate-time check therefore covers all surfaces with path scoping; real run fails before applyPendingWriteBacks. Sound.
- Analyze: analyzeNodes callers in PipelineService are :367 (create-time), :999, :1122 (concise), :1333, :1436; WorkspaceContextService:310 goes through pipelineService.analyze. UpsertSourceAnalyzeStepResponse carries validationError (:1740). D5 is feasible and covers them.
- 404/422 boundary and D3 code choice: reasoning is coherent (config-class, kind immutable: no sourceType update path found in the repo). Spec delta scenarios cover AC; tasks cover repro, RLS spec (4.6), mutation (4.8), stored rows (4.5/4.9), fixtures (4.7: 22 backend test files use existingSource, incl. cycle/reference-guard/existence-leak specs, so the fallout plan is necessary and present).
- HEL-1252 consistency: non-goal states reference-blocking unchanged; 4.5 pins it.

### Verdict: CONFIRM

### Non-blocking notes (executor should resolve in implementation)
1. D4 gap: `findByIdOwned` takes an `AuthenticatedUser`, but `PipelineExecutionContext` only carries `ownerUserId: Option[String]`. Pick one explicitly: build `AuthenticatedUser(UserId(ownerId))` (source/tokenId default, same as upsertOwnershipCheckF's construction) or add a small owner-uuid kind lookup on the repo. Either keeps the RLS proof (D6) valid; record the choice.
2. Fail-closed `ownerUserId = None` will break every directly-constructed ctx test (UpsertSourceStepSpec, engine specs); budget it under 4.7 and classify as fixture-shape.
3. D7 SQL: `pipeline_steps.config` is TEXT (V23; V97 warns about it), so the count query needs `config::jsonb->'target'->>'dataSourceId'`, guarded against non-JSON rows.
4. Disclosure: the 422/reason names the source's name+kind to a grantee-editor (and to any previewer). Defensible because findByIdOwned as pipeline owner succeeded and the id is already in the config, but add an explicit assertion in 4.6 that foreign/unknown never reach the kind branch and note this in the report.
5. Patch-set apply fails mid-set at the service and relies on rollback (not a pre-flight); acceptable, but make the 4.2 test assert the earlier edits are rolled back.

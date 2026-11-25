# Files modified (HEL-1882)

Base c939f3781 (resolved live). Commits: f4ecb3a5d (test-only RaceLocks extraction), 27aaabc5d (SEAM: render observer, no-op default, behaviour-neutral), 353dd3f78 (red tests + red-run.txt, no production check), then the implementation commit and the closing commit.

## Production
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala` — `insertInternal` takes a REQUIRED `actor` and runs `PipelineWriteAccess.requireAction` right after `lockPipelines(OutputCreate)` (D1); `updateOwned` runs the same check first inside its transaction, both branches (D3).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala` — `currentWriteAccessInternal` (system-context current owner/editor/viewer/none read), kept separate from `findByIdShared` (D2/D4 start checks).
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — `create` passes `actor` and maps the refusal with `PipelineWriteRefusal.refused` (Viewer 403 `Forbidden`, else `NotFound("Pipeline not found")`); `update` maps `PipelineWriteAccessRevoked` to the existing 404 "Output not found". No `ServiceError.Forbidden(` producer added.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunBackfill.scala` — start check after `findByIdShared`, and `guard = Some(requireAction)` on `overwriteRows` (D2); `user` threaded to the persist helpers; evaluate body extracted to `evaluateAndPersist`.
- `backend/src/main/scala/com/helio/services/insights/InsightRenderService.scala` — SEAM (own commit): constructor `renderObserver`, called from `startRender` for each started render. FIX: `requester: Option[AuthenticatedUser]` threaded `refresh` -> `startRender` -> `renderGuarded`; start check; `RenderResult.Refused` (D4). `InsightAccess` was NOT made non-final (the AccessChecker-wrapper seam worked).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoRestorers.scala` — `restoreBoundOutputs` passes `actor = user`.

## Production call sites
- `OutputRepository.insertInternal`: `OutputService.create` (OutputService.scala ~159), `PatchSetUndoRestorers.restoreBoundOutputs` (:176). (`insertInternalAction`, used by single-call pipeline create, unchanged.)
- `OutputRepository.updateOwned`: `OutputService.update` only; `OutputService.update` callers: OutputRoutes.scala:114, PatchSetApplyForward.scala:105, PatchSetApplyRollback.scala:186.
- `InsightRenderService.startRender`: `refresh` (requester Some), `renderForRun` (None), `runCandidates` tick pass (None).
- `PipelineRunBackfill.backfillOutputNode`: via `PipelineRunService.backfillOutputNode` from `OutputService.triggerBackfill` (create, update, backfillCreated).

## Tests (new)
- `backend/src/test/scala/com/helio/testsupport/RaceLocks.scala` — extracted from PipelineGrantRecheckRaceSpec (0.1).
- `backend/src/test/scala/com/helio/testsupport/GrantRecheckSupport.scala` — production access checker over a spec's DbContext.
- `backend/src/test/scala/com/helio/services/pipelines/OutputCreateGrantRecheckSpec.scala` (D1), `OutputBackfillGrantRecheckSpec.scala` (D2 a/b + guards), `OutputPatchGrantRecheckSpec.scala` (D3, NOBYPASSRLS fixture), `backend/src/test/scala/com/helio/services/insights/InsightRefreshGrantRecheckSpec.scala` (D4), `backend/src/test/scala/com/helio/api/routes/pipelines/OutputWriteGrantPatchSetRlsSpec.scala` (3.3).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineGrantRecheckRaceSpec.scala` — uses the extracted RaceLocks.

## Tests (mechanical churn): `actor` argument at every `outputRepo.insertInternal(` call site
About 65 existing spec/fixture files under `backend/src/test/**` gained `actor = AuthenticatedUser(<the call's ownerId argument>)` (compile errors were the net, as design.md predicted). No assertion, fixture seed or expectation was changed.

## X2 fixture note (skeptic note 7)
No existing test turned red because of X2: every full-file run (api/routes/pipelines + api/http, services/pipelines + insights, patchsets/workspace/proposals/ask/persistence/dashboards/alerts/..., persistence + alerts + panels) is green with no seed edit.

## Evidence
`.concertino/runs/HEL-1882/evidence/` (main checkout): x2-probe.txt, red-run.txt (also in this change dir), mutations/, green1.txt, sh1-4.txt, patchset-refusal-outcomes.txt.

## Every changed file (declared one per bullet; the mechanical-churn files differ only by the added `actor =` argument)
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala` — see above
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala` — see above
- `backend/src/main/scala/com/helio/services/insights/InsightRenderService.scala` — see above
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoRestorers.scala` — see above
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — see above
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunBackfill.scala` — see above
- `backend/src/test/scala/com/helio/api/ApiRoutesAlertHistoryWiringSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/http/ExistenceNotLeakedRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/alerts/AlertEventRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/ask/AskPinRealRouteSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicDashboardRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicProvenanceRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicRouteOwnerIdLeakApiSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicRouteOwnerIdLeakSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/dashboards/ShareTokenPublicAccessSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetPreviewRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetRoutesFixture.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetStaleCheckRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetStaleWidenedFingerprintRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetUndoRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/DraftSaveDeadlockSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/DraftSaveRaceSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputFilteredMetricRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputReferenceMarksSeamSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputWriteGrantPatchSetRlsSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRootRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunResponseCapSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/ProvenanceRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/StepConfigInvalidRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/UpsertTargetWritableRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/pipelines/WindowRollingSeamSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala` — see above
- `backend/src/test/scala/com/helio/api/routes/proposals/DashboardAuthoringRoutesSpec.scala` — see above
- `backend/src/test/scala/com/helio/infrastructure/persistence/PublicPathRlsSmokeSpec.scala` — see above
- `backend/src/test/scala/com/helio/infrastructure/persistence/alerts/AlertEventRepositorySpec.scala` — see above
- `backend/src/test/scala/com/helio/infrastructure/persistence/alerts/AlertRuleRepositorySpec.scala` — see above
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/MultiRootIsolationSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/alerts/AlertEvaluationServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/alerts/AlertEventServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/alerts/AlertRuleServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/insights/InsightRefreshGrantRecheckSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/insights/InsightRenderServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/panels/PanelCapabilityServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/panels/PanelServiceOutputBindingSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewOutputContextSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoDeadOutputKeysSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoLaneSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoLaterOutputsSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceFixture.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/CastPipelineRunSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/ComputeDateTimeRunSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/ComputeExpressionRunSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/Hel1516GranteeDriftPreviewSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/LateFinisherSpecBase.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/LiveRunReaperSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/OutputBackfillGrantRecheckSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/OutputConfigKeyValidationSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/OutputCreateGrantRecheckSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/OutputFilteredMetricMeasurementSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/OutputHeatmapHistogramSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/OutputHistoryCostMeasurementSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/OutputPatchGrantRecheckSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/PipelineGrantRecheckRaceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceAlertBaselineSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceOutputHistorySpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceTerminalOrderingSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/ProvenanceServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/pipelines/RunPathHeapSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/proposals/AuthoringTelemetrySpec.scala` — see above
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceSearchServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceTeardownServiceSpec.scala` — see above
- `backend/src/test/scala/com/helio/testsupport/AskApiHarness.scala` — see above
- `backend/src/test/scala/com/helio/testsupport/GrantRecheckSupport.scala` — see above
- `backend/src/test/scala/com/helio/testsupport/InsightRenderFixture.scala` — see above
- `backend/src/test/scala/com/helio/testsupport/NodePayloadFixtures.scala` — see above
- `backend/src/test/scala/com/helio/testsupport/OutputHistoryApiHarness.scala` — see above
- `backend/src/test/scala/com/helio/testsupport/RaceLocks.scala` — see above
- `backend/src/test/scala/com/helio/testsupport/RunServiceHarness.scala` — see above

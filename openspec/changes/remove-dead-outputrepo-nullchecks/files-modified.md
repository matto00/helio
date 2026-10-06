# Files modified (HEL-1337)

Sources (main-tree line -> action):
- `services/panels/OutputControlsValidator.scala` :56 null branch -> deleted; `require` added; scaladoc rewritten
- `services/workspace/WorkspaceContextService.scala` :132, :308 null branches -> deleted; `require` added; comments (:82, :123-131) rewritten; unused `PagedResult` import dropped
- `services/workspace/WorkspaceSearchService.scala` :76 `&& outputRepo != null` -> deleted; `require` added; comment (:73) dropped
- `services/patchsets/PatchSetApplyResolvers.scala` :637 (pipelineStep delete guard), :774 (`findOwnedOutput` guard) -> deleted
- `services/patchsets/PatchSetApplyTypes.scala` `outputRepoUnavailable`/`OutputRepoUnavailableMessage` + unused `ServiceError` import -> deleted; `require` added to `PatchSetApplyContext`; comment (:106-109) rewritten
- `services/patchsets/PatchSetUndoService.scala` :91 guard + `needsOutputRepo` (only caller) -> deleted; comment rewritten
- `services/patchsets/PatchSetUndoTypes.scala` `require` added to `PatchSetUndoContext`; comment rewritten
- `api/routes/dashboards/PublicDashboardRoutes.scala` :44 `outputRepoOpt: Option[...] = None` -> `outputRepo: OutputRepository` (same slot, no default); all `Some(outputRepo)` arms collapsed (:63,:70,:90,:142,:195,:269,:306); `None`-only arms deleted
- `api/ApiRoutes.scala` :248 `outputRepoOpt` deleted; :251/:252/:274 `Option(dbContext).map` -> plain `pipelineRootRepo`/`nodeSnapshotRepo`/`shareTokenRepo`; :256/:259 -> `resolvedOutputHistoryRepo`/`resolvedNodePayloadHistoryRepo`; :361/:365 -> `adminUsageService`/`productEventService`; :392 -> `connectorRepo`; :444 `aiStepClient` `(Right(_), None)` arm deleted; :637/:644/:665/:678/:704/:748 -> plain `assistantConversationService`/`chatAccessService`/`betaAccessService`/`workspaceTeardownService`/`connectorCompletionTokenRepo`/`authoringConversationRepo`; transitive Opts (`outputServiceOpt`, `outputHistoryServiceOpt`, `shareTokenServiceOpt`, `connectorEntityServiceOpt`, `connectorCompletionServiceOpt`, `alertRuleServiceOpt` input, `autoRunTriggerServiceOpt` input, authoring/refinement matches) collapsed; Option-typed downstream params receive `Some(x)`; `provenanceServiceOpt` stays Option (`pipelineRunRepo` is genuinely nullable)
- `services/pipelines/PipelineService.scala` `createTransactional` re-indented (whitespace only; `git diff -w` empty)

Tests:
- `services/OutputRepositoryRequiredSpec.scala` (new) -- 5 tests, one `require`-fires per D1 class
- `PatchSetPreviewOutputContextSpec`, `PatchSetUndoServiceSpec` -- null-repo-state tests removed (4)
- `WorkspaceContextService{ComputeJoinHints,ClassifySemanticRole,SanitizeSampleRows,ComputeColumnStats,PanelCount}Spec`, `AssistantToolExecutorSpec` -- null outputRepo fixtures -> Mockito double (fixture change, assertions unchanged)
- 7 `PublicDashboardRoutes` specs -- `Some(outputRepo)` -> `outputRepo`

Cycle 2 (spec/comment-only):
- `openspec/changes/remove-dead-outputrepo-nullchecks/specs/patch-set-undo/spec.md` (new) -- REMOVED the "refuse the whole undo ... Output repository is unavailable" requirement (3 scenarios)
- `.openspec.yaml` (`skip_specs` dropped), `proposal.md` (Modified Capabilities names `patch-set-undo`)
- Re-grep of `openspec/specs` for null/missing Output repository / no-DbContext degrade: no other real requirement exists. `patch-set-preview` "Preview context parity with apply" (non-null collaborators) is consistent with the new `require`; `workspace-context-assembly` / `workspace-resource-search` have no null-repo degrade requirement.
- Comment fixes: `ApiRoutesSpec`, `WorkspaceContextServiceSpec`, `PatchSetUndoServiceSpec`, `PublicDashboardRoutes` (line wrap)
- Left alone (follow-up): `OutputRoutes.scala:28`, `ShareTokenValidator.scala:26`

## Declared paths (full, for squash-branch.sh)

- `backend/src/main/scala/com/helio/api/ApiRoutes.scala`
- `backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala`
- `backend/src/main/scala/com/helio/services/panels/OutputControlsValidator.scala`
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala`
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyTypes.scala`
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoService.scala`
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoTypes.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala`
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceSearchService.scala`
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/OutputHistoryPayloadPublicRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/OutputHistoryPublicRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicDashboardRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicProvenanceRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicRouteOwnerIdLeakSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/ShareTokenPublicAccessSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputHistoryQueryCountSpec.scala`
- `backend/src/test/scala/com/helio/services/OutputRepositoryRequiredSpec.scala`
- `backend/src/test/scala/com/helio/services/assistant/AssistantToolExecutorSpec.scala`
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewOutputContextSpec.scala`
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceClassifySemanticRoleSpec.scala`
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceComputeColumnStatsSpec.scala`
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceComputeJoinHintsSpec.scala`
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServicePanelCountSpec.scala`
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSanitizeSampleRowsSpec.scala`
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala`

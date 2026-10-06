# HEL-1295 files modified

## Source (backend/src/main)

- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — `outputRepo` required, `require` added, `defaultSizesFor`/`rejectMissingOutput` null branches deleted, stale comments rewritten
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — required + `require`; deleted the three `outputRepo == null` branches (create InternalError guard, removeRoot InternalError guard, laneTree empty-fallback)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — required + `require`; deleted `previewOutputs` InternalError guard, `persistBackfilledRows` skip, and the `outputRepo != null` operand of the materialized-write and alert-evaluation conditions
- `backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala` — required + `require`; import outputId check no longer skippable
- `backend/src/main/scala/com/helio/services/dashboards/DashboardContentsService.scala` — required + `require`
- `backend/src/main/scala/com/helio/services/proposals/DashboardProposalService.scala` — required + `require`
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala` — `preValidateBindings.outputRepo` required + `require` at entry; `validateDataTypeBinding` null-skip deleted
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `dbContext` required (no `= null`); one real `outputRepo = new OutputRepository(dbContext)` passed directly at every site (no `outputRepoOpt.orNull`); `outputRepoOpt = Some(outputRepo)` for the Option-shaped consumers. `Main.scala` NOT modified (it already passes `dbContext = ctx`).

## New tests

- `backend/src/test/scala/com/helio/services/panels/PanelServiceOutputBindingSpec.scala` — D6: nonexistent / other-user outputId rejected (`NotFound("Output not found")`) on create AND update, no panel written / binding unchanged (real EmbeddedPostgres + real OutputRepository); plus an own-Output control; plus task 2.4a: explicit-null construction of `PanelService` and `DashboardService` throws `IllegalArgumentException`
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala` — task 2.5: undo of a deleted output panel whose Output no longer resolves is not recreated (regression guard only, see Evidence); stale "nullable outputRepo skips the check" comment rewritten

## Evidence (C2: reproducible red runs)

1. **Would-have-caught (D6.1) against main.** `git worktree add --detach /home/matt/Development/helio/.claude/worktrees/tmp-hel1295-main-red main` (HEAD e29f580cd). Copied `PanelServiceOutputBindingSpec` in with ONE change: `new PanelService(panelRepo, accessChecker, dashboardRepo)` (repository omitted, as main permitted -> default null) and the two D2 `require` tests removed (they cannot pass on main). Command: `cd <that worktree>/backend && HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt "testOnly com.helio.services.panels.PanelServiceOutputBindingSpec"`. Result `Tests: succeeded 1, failed 4`: create+nonexistent -> `PSQLException ... violates foreign key constraint "panels_output_id_fkey"` (a 500, not a clean rejection); create+other-user Output -> `Right((OutputPanel(...)))` was not equal to `Left(NotFound("Output not found"))` (a foreign Output silently BOUND); update+nonexistent -> same FK PSQLException; update+other-user Output -> `Right(OutputPanel(...))` not equal to `Left(NotFound(...))`. Only the own-Output control passed. Worktree then removed with `git worktree remove --force <exact path above>`.
2. **Guard is failable (D6.2).** Mutated `rejectMissingOutput`'s `Some(outputId)` branch to `Future.successful(Right(()))`: `Tests: succeeded 3, failed 4` (the four reject tests red). Reverted (file restored byte-for-byte from a pre-mutation copy).
3. **D2 `require` is failable (2.4a).** Deleted `require(outputRepo != null, ...)` from `PanelService`: `Tests: succeeded 6, failed 1` (the PanelService null-construction test red). Reverted. (The DashboardService null test is the "one more of the seven"; its `require` was not separately mutated.)
4. **Undo case (2.5)** is NOT mutation-sensitive: with the app-level check mutated out the `panels.output_id` FK still refuses the recreate, so it stays green. It is a regression guard; the check itself is pinned by (1)/(2).

## Call-site table (D5/C1)

"Outcome changed" = the test's expected result differs from before. Every row not flagged below: **no**.

### Outcome-affecting findings (C1)

- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRootRoutesSpec.scala` — **outcome changed (test deleted)**: "500s and removes NOTHING when outputRepo is not wired" and its `routesWithoutOutputRepo` helper. That asserted the typed `InternalError` fail-closed guard in `PipelineService.removeRoot`, which D3 deletes as unreachable (D2 makes an unwired repo a construction-time `IllegalArgumentException`; the compile error covers the omitted case). The "fully wired removeRoot reports and removes correctly" tests remain and are unchanged.
- `backend/src/test/scala/com/helio/services/panels/PanelServiceBuildAllForCreateSpec.scala` — **expected result unchanged, setup changed**: the "build a real OutputPanel for type output" test passed `outputId = "out-1"` and passed ONLY because a null repository skipped the check. The unstubbed Mockito double now NPE'd (null Future) in the un-skipped `rejectMissingOutput`; fixed by stubbing `findByIdOwned(OutputId("out-1"), user)` to return an owned Output. Same assertions. (Surfaced by the first full run.)
- `backend/src/test/scala/com/helio/services/assistant/AssistantToolExecutorSpec.scala` — helper `newExecutor` default `outputRepo = null` fed `DashboardProposalService`; that service now gets a Mockito double when the helper's repo is null (the helper's null still goes to WorkspaceContext/Search/PanelCapability, whose own null handling is out of scope). No assertion changed.
- `backend/src/test/scala/com/helio/services/panels/PanelServiceDefaultLayoutSpec.scala` — two `outputRepo = null` -> `mock(classOf[OutputRepository])` (non-output divider panels; repo never touched). No outcome change.
- `backend/src/test/scala/com/helio/api/**` six dbContext-omitting ApiRoutes specs (`ApiRoutesCorsErrorHandlingSpec`, `ApiTokenAuthSpec`, `HookRoutesSpec`, `MfaApiRoutesSpec`, `UploadRoutesSpec` x2 sites, `DashboardPanelAclSpec`) plus `ApiRoutesSpec` (2 sites) and `AuditMutationInstrumentationSpec` (3 sites): each now passes its existing EmbeddedPostgres `dbContext = ctx`/`dbContext`. Assertions diffed: **no assertion edited**; full suite green, so no 404/503-for-absent-route-family outcome changed (design note B).

### Production wiring (D7)

- `Main.scala:269` already passes `dbContext = ctx` (unmodified, `git diff` empty for it).
- `ApiRoutes` now: `private val outputRepo: OutputRepository = new OutputRepository(dbContext)` and passes `outputRepo` to DashboardService, PanelService, DashboardProposalService, DashboardContentsService, PipelineService, PipelineRunService (named arg), OutputControlsValidator, PanelCapabilityService, patch-set contexts, WorkspaceSearchService. Production already always built a non-null repo from the non-null `ctx`, so behaviour is identical.

### Fixture construction sites changed (omitted repository now passed; file | service -> what it passes)

- `backend/src/test/scala/com/helio/api/routes/ResourceTaggingSpec.scala` — PipelineService x2 -> the spec's existing real `outputRepo`; DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetPreviewRoutesSpec.scala` — PipelineService -> the spec's existing real `outputRepo`; PanelService -> the spec's existing real `outputRepo`; DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetRoutesSpec.scala` — PipelineService -> the spec's existing real `outputRepo`; PanelService -> the spec's existing real `outputRepo`; DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetUndoRoutesSpec.scala` — PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres); PanelService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres); DashboardService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/patchsets/RefinementRoutesSpec.scala` — PipelineService -> the spec's existing real `outputRepo`; PanelService -> the spec's existing real `outputRepo`; DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/JoinStepConfigSeamSpec.scala` — PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAclSpec.scala` — PipelineRunService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres); PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeCanRunRoutesSpec.scala` — PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala` — PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineCapabilitiesRoutesSpec.scala` — PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRootRoutesSpec.scala` — PipelineService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` — PipelineRunService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepReparentRoutesSpec.scala` — PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` — PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/pipelines/SseReconnectGapProbeSpec.scala` — PipelineRunService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala` — PipelineService -> the spec's existing real `outputRepo`; PanelService -> the spec's existing real `outputRepo`; DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/api/routes/proposals/DashboardAuthoringRoutesSpec.scala` — DashboardService -> the spec's existing real `outputRepo`; PipelineService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/infrastructure/persistence/dashboards/DashboardLayoutRepairRlsSpec.scala` — DashboardService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/services/dashboards/DashboardServiceLayoutPolicySpec.scala` — DashboardService -> `mock(classOf[OutputRepository])` (typed double, never reached on the exercised path) — outcome changed: no
- `backend/src/test/scala/com/helio/services/panels/PanelServiceBatchUpdateErrorSpec.scala` — PanelService -> `mock(classOf[OutputRepository])` (typed double, never reached on the exercised path) — outcome changed: no
- `backend/src/test/scala/com/helio/services/panels/PanelServiceBuildAllForCreateSpec.scala` — PanelService -> `mock(classOf[OutputRepository])` (typed double, never reached on the exercised path) — outcome changed: no
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyFormCreateSpec.scala` — PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres); PanelService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres); DashboardService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — PipelineService -> the spec's existing real `outputRepo`; PanelService -> the spec's existing real `outputRepo`; DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewOutputContextSpec.scala` — PipelineService -> the spec's existing real `outputRepo`; PanelService -> the spec's existing real `outputRepo`; DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewServiceSpec.scala` — PipelineService -> the spec's existing real `outputRepo`; PanelService -> the spec's existing real `outputRepo`; DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala` — PipelineService -> the spec's existing real `outputRepo`; DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/services/patchsets/RefinementServiceSpec.scala` — PipelineService -> the spec's existing real `outputRepo`; PanelService -> the spec's existing real `outputRepo`; DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/services/pipelines/AutoRunGuardBurstProofSpec.scala` — PipelineRunService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/services/pipelines/AutoRunGuardNoRetryStormSpec.scala` — PipelineRunService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/services/pipelines/DatasetWriteAutoRunCoalescingSpec.scala` — PipelineRunService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/services/pipelines/DatasetWriteAutoRunEndToEndSpec.scala` — PipelineRunService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/services/pipelines/Hel914Ac1EndToEndSpec.scala` — DashboardService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeConciseByteBudgetSpec.scala` — PipelineService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/services/pipelines/PipelineInlineSqlShapeSpec.scala` — PipelineService -> `mock(classOf[OutputRepository])` (typed double, never reached on the exercised path) — outcome changed: no
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala` — PipelineRunService x2 -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/services/pipelines/PipelineSchedulerServiceSpec.scala` — PipelineRunService -> `new OutputRepository(ctx)` (real, EmbeddedPostgres) — outcome changed: no
- `backend/src/test/scala/com/helio/services/pipelines/PipelineServiceInlineRestBodySpec.scala` — PipelineService -> `mock(classOf[OutputRepository])` (typed double, never reached on the exercised path) — outcome changed: no
- `backend/src/test/scala/com/helio/services/proposals/AuthoringTelemetrySpec.scala` — DashboardService -> the spec's existing real `outputRepo`; PipelineService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/services/proposals/CombinedProposalServiceValidateSpec.scala` — DashboardProposalService -> `mock(classOf[OutputRepository])` (typed double, never reached on the exercised path) — outcome changed: no
- `backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringServiceSpec.scala` — DashboardService -> the spec's existing real `outputRepo`; PipelineService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceAgentContextSpec.scala` — DashboardService -> the spec's existing real `outputRepo`; PipelineService -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala` — DashboardService x2 -> the spec's existing real `outputRepo` — outcome changed: no
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceSearchServiceSpec.scala` — DashboardService -> the spec's existing real `outputRepo`; PipelineService -> the spec's existing real `outputRepo` — outcome changed: no

Also edited for the same purpose without a construction-site row above: `PipelineAclSpec`, `PipelineAnalyzeRoutesSpec`, `PipelineAnalyzeProposalRoutesSpec`, `PipelineStepReparentRoutesSpec`, `PipelineStepRoutesSpec` (a class-level `outputRepo` var assigned beside `ctx`, since `ctx` is local to `beforeAll`); `ResourceTaggingSpec`, `RefinementRoutesSpec`, `RefinementServiceSpec`, `PatchSetPreviewServiceSpec` (existing `outputRepo` definition moved ahead of its first use, forward-reference / init-order). Sites that already passed a real repo (about 57 `NAMED`/positional, e.g. `PipelineRunServiceSpec`, `OutputRoutesSpec`) are untouched.

## Verification

- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` -> exit=0, `Total number of tests run: 6021`, `Suites: completed 425, aborted 0`, `Tests: succeeded 6021, failed 0`. No FirstRunRoutesSpec timeout, no "Java heap space".
- `grep -rn "OutputRepository = null" backend/src/main` -> empty; `grep -nE "outputRepo [!=]= null"` over the seven files -> only the seven new `require(outputRepo != null, ...)` lines; `grep -c "outputRepoOpt.orNull" ApiRoutes.scala` -> 0; `git diff --stat` for `Main.scala` -> empty.

## Declared paths: ApiRoutes specs summarised in the row above (full paths for squash-branch.sh)

- `backend/src/test/scala/com/helio/api/ApiRoutesCorsErrorHandlingSpec.scala`
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/ApiTokenAuthSpec.scala`
- `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/auth/MfaApiRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardPanelAclSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/hooks/HookRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/sources/UploadRoutesSpec.scala`

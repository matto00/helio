## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD e8e033721828735ba9c2738fa56e40e0179d0e13 against base e29f580cd.

### Phase 1: Spec Review — PASS
- AC1 (required, no default; no silent skip): all seven services (PanelService, PipelineService, DashboardService, DashboardProposalService, DashboardContentsService, PipelineRunService, ProposalPanelSupport.preValidateBindings) take outputRepo with no default, plus a construction-time require. Every silent-skip/InternalError null branch in them is deleted (PanelService.rejectMissingOutput/defaultSizesFor, DashboardService.validateImportPanels, ProposalPanelSupport.validateDataTypeBinding, PipelineService x3, PipelineRunService x4). Greps over backend/src/main: the only `outputRepo ==/!= null` hits in the seven files are the require lines. Remaining null handling is in out-of-scope files (OutputControlsValidator, WorkspaceContext/SearchService, PatchSetApply*/Undo - the HEL-1256 typed rejection, PublicDashboardRoutes) - not on the ticket's list.
- AC2: every call site passes a real repo or a typed Mockito double (never null). The only `outputRepo = null` in tests are the two deliberate D2 construction-fails tests and PatchSetUndoServiceSpec:713 (the HEL-1256 typed-rejection test).
- AC3: PanelServiceOutputBindingSpec covers nonexistent and other-user outputId on create and update, with real EmbeddedPostgres.
- AC4: Main.scala unmodified (empty diff); ApiRoutes now requires dbContext and builds one real OutputRepository passed directly (no .orNull for outputRepo).
- Scope: no frontend, ci.yml, .gitignore or playwright.config.ts changes. Behaviour-preserving in production (ctx was always non-null).
- C1: assertion-level diff of all touched api specs shows the only assertion lines removed are the deleted PipelineRootRoutesSpec test. That deletion is legitimate: it asserted the InternalError guard that is now unreachable (compile error plus require); the fully-wired removeRoot tests remain. PanelServiceBuildAllForCreateSpec: same assertions, setup now stubs findByIdOwned for "out-1" (previously passed only because a null repo skipped the check) - legitimate and disclosed. AssistantToolExecutorSpec helper uses a double only for the proposal service - assertions unchanged. The 6 ApiRoutes specs now pass dbContext; no assertions edited.
- C2: independently reproduced red. In a throwaway detached worktree I mutated rejectMissingOutput's Some branch to Right(()): `Tests: succeeded 3, failed 4` (reject tests red, incl. foreign Output silently bound, and FK PSQLException on nonexistent). Worktree removed afterward. Method documented in files-modified.md.

### Phase 2: Code Review — PASS
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: exit 0, 6021 tests, 425 suites, 0 failed, 0 aborted. No FirstRunRoutesSpec timeout, no "Java heap space". sbt client shut down separately.
- Frontend gates N/A (no frontend files changed).
- Deleted code is dead after the change; no leftover TODOs; require messages are clear. Minor: PipelineService.createTransactional body keeps an extra indent level after removing the else (cosmetic).

### Phase 3: UI Review — N/A
Backend-only; no frontend/schemas/openspec specs/ApiRoutes route changes (ApiRoutes change is constructor wiring only, no route shape change).

### Overall: PASS

### Non-blocking Suggestions
- PatchSetUndoServiceSpec's new undo test is a regression guard only (FK would also refuse); executor disclosed this honestly.
- Follow-up candidates (out of scope): OutputControlsValidator, WorkspaceContext/SearchService, PatchSetApply context still tolerate a null outputRepo.

## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD e8e033721828735ba9c2738fa56e40e0179d0e13 against live base e29f580cd.

### What I verified (with evidence)
- AC1 (required, no default): `git diff` of backend/src/main shows PanelService, PipelineService, DashboardService, DashboardProposalService, DashboardContentsService, PipelineRunService, ProposalPanelSupport.preValidateBindings all drop `= null`; each service also has a construction-time `require(outputRepo != null)`. Remaining `outputRepo == null` greps in main are only in services outside the ticket's list (WorkspaceContext/Search, OutputControlsValidator, PatchSetApply*, PatchSetUndo typed rejection from HEL-1256) - out of scope.
- AC2: whole test tree compiles (testOnly compiles all). Call sites pass a repo; unit specs without a DB pass `mock(classOf[OutputRepository])` (non-null, not a null). Gray area vs "real repository" - see notes. Specs with a DB use real OutputRepository.
- AC3: PanelServiceOutputBindingSpec (EmbeddedPostgres, real OutputRepository): nonexistent and foreign-owned outputId rejected on create and update with nothing written; owned-Output control; require-null tests. Failability by reasoning: with the check removed, a nonexistent id hits the panels.output_id FK (failed Future, test throws) and a foreign-owned id inserts successfully (Right, assertion fails). The PatchSetUndo test self-discloses it is a guard not a mutation proof (FK still refuses) - honest.
- AC4: Main.scala:243-269 passes `dbContext = ctx` (named arg, unchanged by diff; Main untouched). ApiRoutes now makes `dbContext` required and builds `new OutputRepository(dbContext)`; every service gets that same instance previously derived via `Option(dbContext)...orNull`, so prod values are identical. The only `new ApiRoutes` in main is Main's.
- Behaviour preservation: every deleted null branch (PanelService.rejectMissingOutput/defaultSizesFor, DashboardService.validateImportPanels, PipelineRunService x4, PipelineService create/removeRoot/laneTree, ProposalPanelSupport) was unreachable in prod since outputRepo was always non-null there. Only behaviour change is in no-DbContext fixtures, which is the intended point.
- Deleted PipelineRootRoutesSpec test ("500s ... when outputRepo is not wired") and its helper: legitimate, it asserted the now-impossible null-wired state; the replacement contract is the constructor `require` (pinned by PanelServiceOutputBindingSpec for Panel/Dashboard).
- PanelServiceBuildAllForCreateSpec stub: the output-kind test previously passed only because the check was skipped; the stub now resolves "out-1" via findByIdOwned and the same assertions hold - legitimate (not a weakened assertion), and disclosed in the test comment.
- No bug folded in: diff is signature/null-branch removal plus brace/indent reflow of PipelineRunService.previewOutputs and PipelineService.createTransactional; no logic changes seen.
- Tests run fresh: `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt "testOnly services.panels.* PatchSetUndoServiceSpec PipelineRootRoutesSpec services.dashboards.* ApiRoutesSpec"` -> 309 run, 309 passed, 0 failed, 16 suites. No FirstRunRoutesSpec timeout or "Java heap space" (FirstRunRoutesSpec not in this targeted run). `sbt --client shutdown` run separately. No temp worktree created; no shared DB writes; ci.yml/.gitignore/playwright.config.ts untouched (not in diff stat).

### Verdict: CONFIRM

### Non-blocking notes
- Several unit specs satisfy "required" with a bare Mockito mock rather than a real repository; acceptable since the check is not exercised there, but the literal AC wording prefers real.
- Reformatting of large blocks (previewOutputs) inflates the diff; indentation in createTransactional is now off by one level.
- Full testFull was not run by me; targeted coverage was the changed-area specs plus whole-tree compilation.

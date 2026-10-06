## Context

See proposal.md - Why. Verified against main @ e29f580cd (premise-validation.md):

- `= null` defaults: `PanelService.scala:73`, `PipelineService.scala:66`, `PipelineRunService.scala:79`,
  `DashboardService.scala:53`, `DashboardContentsService.scala:44`, `DashboardProposalService.scala:43`,
  `ProposalPanelSupport.scala:158` (`preValidateBindings`; the private `validateDataTypeBinding` at :222 is already
  required but null-skips at :226).
- Null branches on `outputRepo` in those files: silent skips at `PanelService` :254 (default sizing) and :635
  (`rejectMissingOutput`), `DashboardService` :435 (import outputId check), `ProposalPanelSupport` :226,
  `PipelineService` :1170 (`laneTree` -> empty), `PipelineRunService` :790 (backfill refresh), :1409
  (materialized writes), :1528 (alert evaluation); typed fail-closed `InternalError`s at `PipelineService` :320, :868
  and `PipelineRunService` :420.
- Prod: `Main.scala:269` passes `dbContext = ctx`; `ApiRoutes.scala:250` derives
  `outputRepoOpt = Option(dbContext).map(new OutputRepository(_))` and passes `outputRepoOpt.orNull` at :369, :377,
  :381, :384, :476, :576, :811. The only remaining null source is `ApiRoutes`' own `dbContext: DbContext = null`
  default (:161); 6 route specs omit it (all already run EmbeddedPostgres).
- No other `src/main` code constructs these services (grep `new <Service>(`).

## Goals / Non-Goals

**Goals:** a forgotten repository is a compile error; an explicit `null` fails loudly at construction; no check on the
listed paths is ever skipped for lack of a repository; prod behaviour identical.

**Non-Goals:** see proposal.md Non-goals. No change to any other nullable collaborator.

## Decisions

**D1 - Required parameter, no default, in place.** Drop `= null` on the seven parameters without reordering them
(Scala permits a non-defaulted parameter after defaulted ones; reordering would churn every positional caller for no
gain). Callers that relied on the default stop compiling, which is the acceptance criterion.
Alternative rejected: `Option[OutputRepository]` - nothing genuinely needs an absent repository once fixtures pass
one, so an Option would just re-introduce a skippable branch.

**D2 - Fail fast on explicit null.** Each of the six classes adds
`require(outputRepo != null, "<Class> requires an OutputRepository")` in its body; `preValidateBindings` does the
same at entry. A required type alone does not stop `x.orNull`; this does, at wiring time, not mid-request.
Alternative rejected: typed `ServiceError` per call - that is the HEL-1256 shape for a *genuinely optional*
dependency; here the dependency is mandatory, so a request-time error would only defer a wiring bug.

**D3 - Delete every null branch on `outputRepo` in the seven files.** Silent skips become the unconditional real
check; the three typed `InternalError` guards become unreachable after D2 and are deleted too (compound conditions
such as `nodeSnapshotRepo != null && outputRepo != null` keep only the other operand). Prod always had a non-null
repository, so every prod path executes exactly what it executed before. Comments describing the old nullable
convention for `outputRepo` are rewritten, not left stale.

**D4 - ApiRoutes builds a real repository.** `dbContext` loses its `null` default; `ApiRoutes` holds
`outputRepo = new OutputRepository(dbContext)` and passes it directly (no `.orNull`) at every site above, including
:576 (patch-set contexts) and :811 (`WorkspaceSearchService`). `outputRepoOpt` consumers (:508/:514) use the same
instance. The 6 route specs that omit `dbContext` pass their existing EmbeddedPostgres `DbContext`. `Main` is not
edited. Other `Option(dbContext)` derivations are left alone (Non-goal).

**D5 - Fixtures: real repository or typed double, never null.** DB-backed specs pass
`new OutputRepository(ctx)`. DB-less specs pass a Mockito `mock(classOf[OutputRepository])` (already the pattern in
`AssistantServiceSpec`), stubbing exactly the methods the exercised path calls (a shared testkit helper is fine).
Because D3 turns skips into real calls, a fixture whose path now reaches the repository must be stubbed/seeded so
the test still asserts the same outcome. **Any test whose expected outcome had to change** (it passed only because
the check was skipped) is a finding: list it in the call-site table, do not silently re-baseline it.

**D6 - The red test.** New coverage on `PanelService` create AND update for an `"output"` panel whose `outputId` is
(a) nonexistent and (b) a real Output owned by another user: both rejected with `NotFound("Output not found")`, and
no panel row written. EmbeddedPostgres-backed (real `OutputRepository`, real ownership). Red evidence, both required:
1. *Would have caught it:* the same assertions run against main's `PanelService` constructed the way main allowed
   (repository omitted -> default `null`) fail on main (panel accepted or FK 500). Capture the failing output.
2. *Guard is failable:* mutating `rejectMissingOutput` to return `Right(())` turns the new tests red; revert.
Also one undo-path case (`PatchSetUndoService` recreating a deleted output panel whose Output no longer resolves is
rejected rather than recreated) if an existing undo spec fixture makes it cheap; otherwise state why not.

**D7 - Prod-wiring proof.** The PR body quotes `Main.scala` (`dbContext = ctx`) and the post-change ApiRoutes
construction, and the call-site table records every changed construction site (main + test) with what it now passes.

## Risks / Trade-offs

- [~130 fixture edits hide an outcome change] -> D5's "outcome changed = finding" rule plus the table; evaluator
  diffs assertions, not just constructors.
- [Mockito default answers return `null` Futures -> NPE in a now-unskipped path] -> stub per D5; an NPE in a test is
  a missing stub, not a reason to restore a null branch.
- [6 route specs gain real dbContext-derived collaborators (AI step client gate, history repos)] -> they already run
  EmbeddedPostgres; failures there are fixture setup, reported if behavioural.
- [`require` throws during `ApiRoutes` construction if anything passes null] -> intended; prod never does.

## Planner Notes

- Self-approved: removing `ApiRoutes.dbContext`'s default is required by AC2 (ApiRoutes is itself a call site
  passing `.orNull`); no product decision involved.
- Self-approved: `skip_specs: true` - no observable behaviour change in prod.
- Follow-up (not filed): required-but-null-checked `outputRepo` in OutputControlsValidator:56,
  WorkspaceContextService:132/308, WorkspaceSearchService:76, PatchSetApplyResolvers:637/774.

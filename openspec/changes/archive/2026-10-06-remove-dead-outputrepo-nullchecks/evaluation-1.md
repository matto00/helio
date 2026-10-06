## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 0638da376a8b208236a8b128a6fc5924f13846c6 (base a5a2fa2ce70de4105e48c9e08ecb52a8c6932cd4, resolved live via resolve-review-base.sh)

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (remove each dead branch, behaviour unchanged): every site the ticket named is gone, plus the same-shape
  `PatchSetUndoService:91` and its only helper `needsOutputRepo`. `outputRepoUnavailable` /
  `OutputRepoUnavailableMessage` have zero remaining references. `PublicDashboardRoutes` takes a required
  `outputRepo: OutputRepository` in the same positional slot. All 16 `Option(dbContext)` sites in `ApiRoutes` are
  plain values. Grep of `backend/src/main` for `outputRepo == null`, `Option(dbContext)`, `outputRepoOpt`,
  `outputHistoryRepoOpt`, `nodePayloadHistoryRepoOpt`, `Option(outputRepo)` and `dbContext == null` finds nothing
  left except the intended `require(outputRepo != null, ...)` guards.
- AC2 (null checks a test exercised): the null-fixture specs now get a Mockito double, with their assertions
  unchanged. The tests that asserted the degraded null-repo result were removed, not rewritten.
- AC3 (test count): the counts reconcile. See Phase 2.
- C1 (zero aborted suites, named reconciliation): met in the executor's baseline, the executor's final run and my
  own independent run.
- C2 (ApiRoutes val order, no Some(null)): met. For every converted val I compared its definition line with its
  first non-comment use (ApiRoutes.scala at HEAD). Each is defined before it is read:
  - `pipelineRootRepo` 248 < 265
  - `shareTokenRepo` 269 < 270
  - `productEventService` 355 < 356
  - `connectorRepo` 381 < 387
  - `outputService` 476 < 531 (and `pipelineRunService` 441 < 476)
  - `connectorCompletionTokenRepo` 656 < 661
  - `authoringConversationRepo` 692 < 704
  - the rest are used only in the `routes` block (line 800 and later)
  `aiStepClient` still builds its quota gate from `dbContext` directly. It was not reworked to reuse
  `chatAccessService`.
- Driver rule "escalate if public-route behaviour changes": not triggered. Every caller (ApiRoutes plus 7 specs)
  already passed `Some(outputRepo)`. Each collapsed match arm is identical to the old `Some` arm. The arms that are
  gone (`case _` / `case None` on `outputRepoOpt`) could only be reached with `None`.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (I ran them myself; changed files are `backend/**` only, so there are no frontend gates):
- `nice -n 19 sbt testFull` (from backend/, default HEL-924 grouping, which runs one forked group at a time, so 2
  workers or fewer). Exit 0.
  - Totals: `Tests: succeeded 6031, failed 0, canceled 0, ignored 0, pending 0`
  - Suites: `Suites: completed 427, aborted 0`
  - Log: /tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1337-eval.log
- No FirstRunRoutesSpec timeout (the suite ran 06:07:44 to 06:07:47). No "Java heap space".
- The only "timed out" string in the log is the deliberately thrown `RuntimeException("upstream lookup timed out")`
  in ClaudeClientSpec's tool-error-recovery test.
- `npm run check:scala-quality`: clean. The 211 soft file-size warnings were already there before this change.

Test-count reconciliation (executor's claim, checked against the logs):
- Baseline log: 6030 tests, 426 suites, 0 aborted.
- Final log: 6031 tests, 427 suites, 0 aborted.
- The baseline log contains the 4 removed test names and no `OutputRepositoryRequiredSpec`. The final log is the
  reverse. So the baseline really was run before the change.
- 6031 = 6030 − 4 + 5. The +1 suite is `OutputRepositoryRequiredSpec`.

Removed tests (each one asserted a state that can no longer happen):
1. PatchSetPreviewOutputContextSpec: "return a typed ServiceError ... when outputRepo is null". It constructs
   `PatchSetPreviewService(..., null)`, which the new `PatchSetApplyContext` `require` now rejects at construction.
2. PatchSetUndoServiceSpec: "reject a pipelineStep delete with bound Outputs ..." (null outputRepo).
3. PatchSetUndoServiceSpec: "reject a pipelineStep create rather than reporting a 0 placement count ..." (null
   outputRepo).
4. PatchSetUndoServiceSpec: "still undo an application that never needs the Output repository". It goes through
   `undoServiceWithoutOutputRepo` (`outputRepo = null`). The undo path itself is still covered by the other undo
   tests, which use a real repo.

Added tests: 5 in OutputRepositoryRequiredSpec, one per `require` site (OutputControlsValidator,
WorkspaceContextService, WorkspaceSearchService, PatchSetApplyContext via preview and apply, PatchSetUndoContext).
Each checks for an IllegalArgumentException with the class-specific message, so it would fail if its `require`
were removed.

Behaviour-preservation:
- `createTransactional`: `git diff -w` for PipelineService.scala is empty, so the change is whitespace-only.
- In ApiRoutes, each `.orNull` / `.fold(reject)` / `for` collapse picks the same arm that ran before, because
  `dbContext` was already non-null.
- `alertRuleServiceOpt`, `autoRunTriggerServiceOpt` and `provenanceServiceOpt` keep only their genuinely optional
  inputs (`alertRuleRepo`, `autoRunDebounceRepo`, `pipelineRunRepo`).
- Downstream Option-typed parameters get `Some(x)`, as design D5 specifies.
- The removed log-warn arms ("no DbContext configured") were unreachable.
- The public `val`s were renamed from `outputHistoryRepoOpt` to `resolvedOutputHistoryRepo` and from
  `nodePayloadHistoryRepoOpt` to `resolvedNodePayloadHistoryRepo`. Nothing outside ApiRoutes references them, and
  the build compiles.

Code quality:
- No inline FQNs in added lines.
- The unused `PagedResult` and `ServiceError` imports were removed.
- No dead code, TODOs or over-engineering.

### Phase 3: UI Review — N/A
No `frontend/**`, `schemas/**` or `openspec/specs/**` file changed. `ApiRoutes.scala` changed, but only its internal
wiring: there is no change to any route path, request shape or response shape.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- These test comments still describe the retired convention:
  - backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala:1515 ("non-null `outputRepoOpt`")
  - backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala:125 ("`outputRepoOpt.orNull`")
  - backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala:153 ("an `outputRepo == null` fixture")
  Consider rewording them.
- These two main-source comments still talk about "fixtures without a DbContext". They belong to downstream
  classes whose own Option signatures are a non-goal here, so the comments are only mildly stale. They could be
  noted in the PR's follow-up list.
  - backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala:28
  - backend/src/main/scala/com/helio/services/sharing/ShareTokenValidator.scala:26
- In the WorkspaceContextService*Spec files, the new `OutputRepository` / `mock` imports sit between existing
  imports rather than in sorted position. This is cosmetic only.

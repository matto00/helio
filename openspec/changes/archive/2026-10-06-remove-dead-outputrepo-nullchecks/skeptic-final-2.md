## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 6df885913fec6fc98598ed75a73795a3f05fbe47. Base a5a2fa2ce70de4105e48c9e08ecb52a8c6932cd4, resolved live
via `resolve-review-base.sh` (exit 0). I reviewed the whole change cold, not only the cycle-2 fix.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/remove-dead-outputrepo-nullchecks/HEL-1337`.

- **Full backend suite, fresh run at 6df885913.**
  - Command: `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`, which allows at most 2 workers.
  - Log: scratchpad `hel1337-skf2.log`.
  - Result: `rc=0`, `Suites: completed 427, aborted 0`, `Tests: succeeded 6031, failed 0`.
  - The log was written 06:3x on 2026-10-06, and the five OutputRepositoryRequiredSpec tests appear in it by name.
  - FirstRunRoutesSpec ran from 06:35:03 to about 06:35:17 with no timeout.
  - "Java heap space" occurs 0 times.
  - The only "timed out" lines are a deliberate ClaudeClientSpec exception and Hikari shutdown chatter in
    DatabaseConnectionTimeoutSpec, which is expected there.

- **Test-count reconciliation, derived from the diff rather than from reports.**
  - `git diff base...HEAD -- backend/src/test` removes exactly 4 `" in {` lines and adds exactly 5.
  - The executor's baseline log shows 6030 tests and 426 suites. 6030 − 4 + 5 = 6031, and 426 + 1 new suite = 427.
    Both match my run.
  - Removed tests:
    1. The PatchSetPreviewOutputContextSpec "typed ServiceError (never an NPE) ... when outputRepo is null" test.
    2. The three PatchSetUndoServiceSpec "undo with a null outputRepo (HEL-1256)" tests.
  - All four build their service with `outputRepo = null`. That construction now throws at the
    `PatchSetApplyContext`/`PatchSetUndoContext` `require`, so they asserted states that can no longer occur.
  - The real-repo paths behind those scenarios are still covered in PatchSetUndoServiceSpec:
    - :207, panel update undo
    - :408 and :436, lane delete with a bound Output
    - :478, lane create cascade with placement count
  - Every other test edit is a fixture swap (null -> Mockito double) or `Some(outputRepo)` -> `outputRepo`.
    I checked the AssistantToolExecutorSpec helper's default-null callers. They only reach decode or Left paths.
    At base the `getResource` DataType arm had no null-guard either, so no test's path changed.

- **The require-tests fail under mutation, all five this round.** Round 1 mutated only three.
  - Mutation: I commented out every `require(outputRepo != null, ...)` in OutputControlsValidator,
    WorkspaceContextService, WorkspaceSearchService, PatchSetApplyTypes and PatchSetUndoTypes, then ran
    `sbt "testOnly com.helio.services.OutputRepositoryRequiredSpec"`.
  - Result: `Tests: succeeded 0, failed 5`. Log: `hel1337-skf2-mutation.log`.
  - Restore: `git checkout --` on those exact 5 paths. Afterwards `git status --short` shows only the pre-existing
    untracked `evaluation-2.md`, HEAD is unchanged, and no `MUT` marker remains in `src/main`.
  - `sbt --client shutdown` ran as its own call.

- **ApiRoutes val initialisation order (C2), checked mechanically.**
  - I listed the definition line and every non-comment use of all 23 converted or derived vals. Every use comes
    after its definition. Examples: `resolvedOutputHistoryRepo` 253 < 413/460/488, `connectorRepo` 381 < 387,
    `chatAccessService` 610 < 981, `authoringConversationRepo` 692 < 704/725.
  - `val routes` is at 775, after every definition.
  - `aiStepClient` uses `dbContext` directly, not `chatAccessService`.
  - There is no `Some(null)`: every `Some(x)` wraps a val built from the required `dbContext`.
  - The public `outputHistoryRepoOpt`/`nodePayloadHistoryRepoOpt` vals that were removed have no readers.
    `Main.scala` and the specs have none; grep finds zero hits.

- **Behaviour preservation, production paths.**
  - Each `Option(dbContext).map(f)` became `f(dbContext)`, and each `.fold(reject)(f)`, `.orNull` and
    for-comprehension now takes the arm that was already taken with a non-null `dbContext`.
  - `alertRuleServiceOpt`, `autoRunTriggerServiceOpt` and `provenanceServiceOpt` keep only their genuinely optional
    input.
  - `PipelineService.scala`: `git diff -w` output is 0 lines, so that change is whitespace only.

- **Behaviour preservation, public routes.**
  - In PublicDashboardRoutes, every former `Some(outputRepo)` arm body is unchanged. That covers
    `resolveDataAsOf`, `resolveOrphanedControlIds`, `resolveRows`, `resolvePanelOutput`, output-meta and history.
  - The arms that were deleted were reachable only when `outputRepoOpt` was `None`.
  - Every caller already passed `Some(outputRepo)`, and the default is now gone, so the compiler proves no caller
    relied on it. The driver's escalation rule is not triggered.

- **Spec/code consistency.**
  - The REMOVED delta's header is identical to `openspec/specs/patch-set-undo/spec.md:118` (diff on the exact line:
    HEADER_MATCH).
  - `openspec validate remove-dead-outputrepo-nullchecks --type change` reports "Change ... is valid".
  - `skip_specs` is gone from `.openspec.yaml`, and the proposal names `patch-set-undo`.
  - I grepped all of `openspec/specs` independently for DbContext, outputRepo, "Output repository", "not
    configured", "never an NPE", and repo unavailable/absent/missing/unwired. The only requirement describing
    deleted behaviour is the one this delta removes.

- **Residual dead code.** Grep of `backend/src` for `outputRepo ==/!= null`, `Option(dbContext)`,
  `OutputRepoUnavailable`, `needsOutputRepo` and the removed `*Opt` names finds only:
  - the `require` guards;
  - unrelated `connectorRepoOpt` params on `RestApiConnectorDriver`/`WorkspaceContextService`, a non-goal;
  - two stale comments (see notes below).

- **Scala quality gate:** `npm run check:scala-quality` reports "clean (211 soft warning(s))", rc=0. All warnings are
  pre-existing line-count advisories.

- **Acceptance criteria.**
  - AC1, remove each dead branch with behaviour unchanged: met, as traced above.
  - AC2, any null check a test still exercises is justified or its test updated: met. The fixtures were updated,
    and the null-state tests were removed with reasons.
  - AC3, test count equal apart from enumerated impossible-state removals: met. 6030 − 4 + 5 = 6031, with each
    removal listed in files-modified.md and re-derived here.

- No UI changes, so step 4 does not apply. No real bug was found, so no spinoff is needed.

### Verdict: CONFIRM

### Non-blocking notes
- Stale identifier references in comments, worth a PR follow-up line:
  - `ApiRoutes.scala:340` still says "chatAccessServiceOpt (beta daily cap) below". This file is touched by the
    change; the val is now `chatAccessService`.
  - `AiPipelineQuotaGate.scala:30` cites `ApiRoutes.chatAccessServiceOpt`. Its reasoning about declaration order
    still holds for `chatAccessService`.
  - The evaluator already noted `OutputRoutes.scala:28` and `ShareTokenValidator.scala:26`.
- Several downstream Option-typed params now always receive `Some` from production: `AuthService`,
  `ShareTokenValidatorImpl`, `WorkspaceRoutes`, `DashboardAuthoringRoutes`, `RefinementRoutes`, `OutputRoutes`,
  and `WorkspaceContextService`'s connector and snapshot Opts. That is an explicit non-goal, and a candidate
  follow-up cleanup.
- Gate-defect check: no report I drilled into relies on mtime-ordering evidence. Not applicable.

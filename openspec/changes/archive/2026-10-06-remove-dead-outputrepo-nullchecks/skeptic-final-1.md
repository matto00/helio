## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 0638da376a8b208236a8b128a6fc5924f13846c6. Base a5a2fa2ce70de4105e48c9e08ecb52a8c6932cd4, resolved live
via `resolve-review-base.sh` (exit 0).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/remove-dead-outputrepo-nullchecks/HEL-1337`.
- **Full backend suite, fresh run by me.** Command: `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`, which
  allows at most 2 concurrent forked groups. Log: scratchpad `hel1337-testfull.log`. Result: exit 0,
  `Tests: succeeded 6031, failed 0`, `Suites: completed 427, aborted 0`. Execution was fresh: timestamps are from
  2026-10-06 06:19 to 06:21, and the new spec's five tests appear in the log. FirstRunRoutesSpec ran 06:21:46 to
  06:21:51 with no timeout. There was no "Java heap space". The only "timed out" string is ClaudeClientSpec's
  deliberately thrown exception.
- **Test-count reconciliation (6030 -> 6031), checked from the diff itself:**
  - PatchSetPreviewOutputContextSpec loses one `in`.
  - PatchSetUndoServiceSpec loses the block "undo with a null outputRepo (HEL-1256)", which has three `in`s, plus
    its `undoServiceWithoutOutputRepo` helper.
  - The new OutputRepositoryRequiredSpec has five `in`s.
  - No other spec changes its number of `in`s. The other edits are fixture swaps (null -> Mockito double) and
    `Some(outputRepo)` -> `outputRepo`.
  - So 6030 − 4 + 5 = 6031, which matches my run.
  - Each removed test builds its service with `outputRepo = null`. That construction now throws at the new
    `PatchSetApplyContext`/`PatchSetUndoContext` `require`, so each one asserted a state that can no longer happen.
- **The new require-tests fail under mutation (failable).**
  - Mutation: I commented out the `require` in OutputControlsValidator.scala:24, PatchSetUndoTypes.scala:29 and
    WorkspaceSearchService.scala:43, then ran `sbt "testOnly com.helio.services.OutputRepositoryRequiredSpec"`.
    Result: `Tests: succeeded 2, failed 3`. Exactly the three mutated sites failed. Log: scratchpad
    `hel1337-mutation.log`.
  - Restore: I restored the files with `git checkout -- <the 3 exact paths>`. Afterwards, `git status --short`
    shows only the pre-existing untracked `evaluation-1.md`, and HEAD is unchanged.
- **ApiRoutes val initialisation order (C2).** For every converted val, I compared its definition line with each
  line that uses it. Every use comes after the definition. Lines are in ApiRoutes.scala at HEAD:
  - `pipelineRootRepo` 248 < 265
  - `nodeSnapshotRepo` 249 < 365
  - `resolvedOutputHistoryRepo` 253 < 413
  - `shareTokenRepo` 269 < 270
  - `productEventService` 355 < 356
  - `connectorRepo` 381 < 387
  - `outputService` 476 < 531
  - `connectorCompletionTokenRepo` 656 < 661
  - `authoringConversationRepo` 692 < 704
  - The rest are read only in the `routes` block (line 800 and later).

  There is no `Some(null)`: every `Some(x)` wraps a val that is constructed earlier from the non-null `dbContext`.
- **Behaviour preservation, production paths.**
  - Each `Option(dbContext).map(f)` became `f(dbContext)`. Since `dbContext` is required (HEL-1295), each collapsed
    `.fold(reject)`, `.orNull` and `for`-comprehension takes the arm that was already being taken.
  - The `outputHistoryServiceOpt` for-comprehension was always `Some`.
  - `alertRuleServiceOpt`, `autoRunTriggerServiceOpt` and `provenanceServiceOpt` still keep their genuinely
    optional input.
  - `PipelineService.scala`: `git diff -w` is 0 lines, so that change is whitespace only.
- **Behaviour preservation, public routes.** I read every changed arm in PublicDashboardRoutes:
  - `resolveDataAsOf`, `resolveOrphanedControlIds`, `resolveRows`, `resolvePanelOutput`, output-meta and history all
    keep their former `Some(outputRepo)` arm body unchanged.
  - The arms that were removed were reachable only when `outputRepoOpt` was `None`.
  - All 10 construction sites passed `Some(outputRepo)`. The driver's escalation rule is therefore not triggered.
- **The only production construction sites of the guarded classes pass a real repo.** These are ApiRoutes:368, 525,
  537, 548, 673, 744 and 817, PanelService:96, and PublicDashboardRoutes:63. Nothing in `src/main` calls `.copy` on
  the patch-set contexts.
- **The AssistantToolExecutorSpec fixture change is safe.** The only `find`/`get_resource` dataType test (:541-559)
  passes a stubbed `outRepo`. The default-`null` callers never reach either workspace service's repo.
- **AC1 (remove each dead branch):** met in code. Grep of `src/main` for
  `outputRepo == null|Option(dbContext)|dbContext == null|Option(outputRepo)` returns only the `require`
  guards.
- **AC2 (a null check still exercised by a test must be justified or the test updated):** met in code and tests.
- **AC3 (test count, with each removal listed):** met numerically. However, see CR1: the living spec still mandates
  the behaviour that the removed tests covered.

### Verdict: REFUTE

### Change Requests

1. **A living spec requirement is orphaned, and no spec delta was planned for it (`skip_specs: true` is wrong
   here).**
   - **What the spec says.** `openspec/specs/patch-set-undo/spec.md:118-143` holds the requirement "Undo SHALL refuse
     the whole undo with a typed error when a needed Output repository is unavailable", with three scenarios:
     - lane-delete refused with `Output repository is not configured`;
     - lane-create refused;
     - an application that needs no Output repo undoes normally "whether or not the Output repository is configured".
   - **What this change removed.**
     - The code that implements that requirement: `PatchSetUndoService.needsOutputRepo`, the guard arm at former
       :91, and `PatchSetApplyContext.OutputRepoUnavailableMessage`/`outputRepoUnavailable`.
     - The three tests that were that requirement's scenarios: the deleted `PatchSetUndoServiceSpec` block's three
       `in`s map one-to-one onto those three scenarios.
   - **What still claims otherwise.** The canonical spec still asserts the SHALL. The proposal states "Modified
     Capabilities: None". `.openspec.yaml` sets `skip_specs: true`. The evaluator's Phase 3 note "No openspec/specs/**
     file changed" is true, but that is the defect: the spec needed to change and did not. Archiving this change
     leaves a requirement whose message string no longer exists anywhere in `backend/src/main`, and whose scenarios
     no test covers.
   - **Required fix.**
     - Add `openspec/changes/remove-dead-outputrepo-nullchecks/specs/patch-set-undo/spec.md` with a
       `## REMOVED Requirements` entry for that requirement. Include **Reason** (HEL-1295/HEL-1337: the Output
       repository is required and asserted non-null at `PatchSetUndoContext` construction, so the unavailable state
       cannot occur) and **Migration** (none; a null repo now fails at construction).
     - Precedent for the format: `openspec/changes/archive/2026-09-04-multi-root-pipelines/specs/pipeline-execution/spec.md`.
     - Drop `skip_specs: true` from `.openspec.yaml`.
     - Change the proposal's "Modified Capabilities" to name `patch-set-undo`.
   - **Required check.** Grep `openspec/specs` for any other requirement describing the removed null-repo or no-DbContext
     degrade paths, in particular WorkspaceContext/WorkspaceSearch "dataTypes degrade to empty" and the preview
     "typed ServiceError, never an NPE". My grep found only patch-set-undo, but confirm it.
   - **Required proof.** Run `openspec validate remove-dead-outputrepo-nullchecks` and show it is clean.
   - **Scope.** This is a spec/artifact correction only. No code change is needed.

### Non-blocking notes

- These test comments still describe the retired convention. The evaluator flagged them too, and they are worth
  fixing in the same pass:
  - ApiRoutesSpec.scala:1515 (`outputRepoOpt`)
  - WorkspaceContextServiceSpec.scala:125 (`outputRepoOpt.orNull`)
  - PatchSetUndoServiceSpec.scala:153
- `PublicDashboardRoutes.scala:56` now has a comment line longer than the file's usual wrap width. This is cosmetic.
- I found no real bug that would warrant a spinoff. The remaining Option-typed downstream params (`AuthService`,
  `ShareTokenValidatorImpl`, `WorkspaceRoutes`, `DashboardAuthoringRoutes`, `RefinementRoutes`, `OutputRoutes`,
  `WorkspaceContextService`'s connector/snapshot Opts) are now always `Some` from production. That is a candidate
  follow-up cleanup, already noted as a non-goal.
- No UI changes, so step 4 does not apply.

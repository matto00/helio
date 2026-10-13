## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `40abcbaccba10144e0d127df1ad29c01ed0e60f6` (diff base `fe63a251886c3dfba142151afb8913fb025ef43b`, resolved live via `resolve-review-base.sh`). Scope: ticket items 1-6 (AC1-AC6); items 7-9 deferred to HEL-1542 (driver-authorized, recorded in proposal.md).

### Phase 1: Spec Review — PASS
- AC1 (reorder lane cycle): `PipelineStepRepository.reorderTrunkInternal` checks `LaneCycleViolations.introduced(steps, finalSteps)` inside the `.transactionally` action and raises with `DBIO.failed`; `PipelineStepWrites.reorderSteps` maps `LaneCycleOnReorderException` to `400`. Only newly introduced violations block (D1). Covered by `StepReorderLaneCycleRoutesSpec` (400 + layout unchanged; benign reorder 200; pre-existing violation 200; permutation 422 kept).
- AC2 (create position anchor): `PipelineStepCreate.laneScopeF` takes `prospectiveParent` from `StepPlacement.resolveCreateAnchor` for every successful arm, fallback only on placement failure (D3); the "pre-existing mismatch" comment is gone. Covered by `StepLanePositionAnchorRoutesSpec`.
- AC3 (no existence probe): `StepReferenceChecks.referenceChecksF` now runs `accessF` first (D4). Covered by `StepLaneAccessProbeRoutesSpec` (stranger: identical 404s; viewer: identical 403s) and a step-read counter in `StepReferenceCheckDeferralSpec`.
- AC4 (rollback pin): `PatchSetRollbackLaneStepSpec` pins rollback: the deleted tail-sibling lane referrer stays deleted, edit 0 is `unrecoverable`, the lane target keeps its parent. This matches the ticket's description. The undo half was already pinned before this change by `PatchSetUndoLaneDescendantsSpec` (HEL-1515), which this delivery reuses.
- AC5 (stale and cyclic): new case in `PatchSetStaleCheckRoutesSpec` returns `409 PATCH_SET_STALE` and leaves the config and application count unchanged.
- AC6 (ownership dedup): `StepReferenceChecks.secondarySourceOwnershipF` (companion object, `private[services]`) is the only caller of `PipelineStepConfigCodec.secondaryDataSourceId`. Grep shows only the codec definition plus `StepReferenceChecks.scala:75`. `checkOwnedSource` and both patch-set inline copies are deleted, and each call site keeps its own message text.
- Tasks 1.1-6.2 are all marked done and match the diff. No scope creep and no frontend or schema change. The spec delta matches the implemented behavior.
- Moved expectations (`StepReferenceCheckChainSpec` x2, `StepReferenceCheckDeferralSpec` x2) are the ones D4 predicted. Each moved expectation has a reason comment, and each new answer discloses less than the old one.
- Audit (task 1.3), spot-checked: patch-set create runs `authorizeEditorOrOwnerOnPipeline` before any other step (`PatchSetPipelineStepResolvers.scala` `resolvePipelineStepCreate`). Patch-set update runs `requireVisibleStep` before reading config or lane. `PipelineCreatePreflight.laneChecks` is request-scoped and reads no stored steps.
- Task 3.3: `usePipelineStepMutations.ts:183-200` restores `previousOrder` and shows an error toast on any non-2xx reorder.
- CONSTRAINTS: `[]`, nothing to honor.

### Phase 2: Code Review — PASS
Gates, all run by me on HEAD 40abcbacc in WORKTREE_PATH. Both project-path lines named this worktree in every run.
- Backend only, so the frontend gates were not triggered.
- `npm run check:scala-quality`: clean. 249 soft warnings, all file-size and all pre-existing.
- `node scripts/check-openspec-hygiene.mjs`: clean.
- Scoped `testOnly` of the 8 new or touched specs: 50 succeeded, 0 failed (`[hel1468-guard] failed=0 aborted=0`).
- Full `sbt testFull` sharded 8 ways (`HELIO_TEST_SHARD_INDEX=0..7 HELIO_TEST_SHARD_COUNT=8 HEL924_TEST_GROUP_CONCURRENCY=2`, `nice -n 19`). Every shard exited 0 with guard `failed=0 aborted=0`. Totals: 589 suites, 7775 tests succeeded, 0 failed, 4 canceled. The 4 cancellations are the report-only `HELIO_MEASURE=1` measurement tests. This covers every package, including the `com.helio.api.*`, spark, testkit and testsupport suites the executor had not run on the final tree.
- No compiler `[warn]` lines for any `.scala` file.

Independent mutation checks. Each ran in a throwaway detached worktree at 40abcbacc under the scratchpad, which was removed afterwards (`git worktree list` shows no straggler):
1. Restored the old chain order (ownership -> lane -> access) in `StepReferenceChecks.referenceChecksF`. `StepLaneAccessProbeRoutesSpec` went RED on both tests. Stranger got `existing=404 Pipeline not found`, `trunkLast=400 ... ancestor`, `missing=422 ... does not exist`. Viewer got `403 / 400 / 422`. This matches the executor's red-first claim exactly. The moved `StepReferenceCheckChainSpec` and `StepReferenceCheckDeferralSpec` expectations also went red (7 failures in total).
2. Disabled the reorder `DBIO.failed` (`case Some(v) if false`). `StepReorderLaneCycleRoutesSpec` "400 naming the cycle" went RED: it got 200 and the cycle was persisted.
3. Restored the old trunk-last parent for the bare-`position` arm. Both `StepLanePositionAnchorRoutesSpec` tests went RED: the accept case got 400 "ancestor", and the reject case got 201 for a lane to the anchor `t`. So old code could store a self-parent lane cycle through this arm.

Checklist:
- Code quality: no inline FQNs (gate clean). Imports are at the top of each file. No unused imports.
- DRY: three inline ownership copies are now one primitive.
- Type safety: `typedConfig: Any` is the existing codec contract and is not new.
- Error handling: the reorder lane cycle is mapped to `400` and never reaches `classifyDbError`'s 500.
- No dead code or TODOs.
- The tests are meaningful: all three behavior changes fail under mutation.

Issues: none blocking.

### Phase 3: UI Review — N/A
There are no changes under `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. The spec delta lives under `openspec/changes/`.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `LaneCycleViolations.of` is a second implementation of the direct lane-cycle rule. It has its own ancestor walk, while create and update still use `PipelineService.validateLaneReference` with `ancestorChainOf`/`descendantStepIds`. design.md D1 allowed this, but HEL-1521, which extends the rule to lane-link cycles, should converge the two so they cannot drift apart.
- `com.helio.domain.pipelines.LaneCycleViolations` imports `com.helio.api.protocols.pipelines.PipelineStepConfigCodec`, so the domain layer depends on the api layer. Some existing domain files already do this (panels, ChartAppearance), but moving `secondaryLaneStepId` toward the domain would be cleaner.
- The AC5 test does not show that the same edit, made non-stale, would be refused as cyclic with a 400. A paired control assertion would prove the test exercises the "both" case and not just the stale case.
- `PatchSetRollbackLaneStepSpec` could cite `PatchSetUndoLaneDescendantsSpec` as the undo half of the AC4 pin, so a reader finds both.
- The reorder 400 message includes raw step UUIDs, which the editor's toast shows verbatim. This is the same class of issue as item 7 (picker shows a raw UUID), so it belongs in HEL-1542.
- `StepReferenceCheckDeferralSpec`'s class doc calls the ownership and lane stages "earlier" when it means the later ones.

## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `40abcbaccba10144e0d127df1ad29c01ed0e60f6`. Diff base resolved live with `resolve-review-base.sh` (main/origin): `fe63a251886c3dfba142151afb8913fb025ef43b`. There is one commit on the branch. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/step-reference-check-followups/HEL-1523`.

### What I verified (with evidence)

**AC1: reorder lane cycle (item 1).**
- `PipelineStepRepository.reorderTrunkInternal` (around L907-922) computes `LaneCycleViolations.introduced(steps, finalSteps)` inside the inner for-comprehension. On a violation it raises `DBIO.failed(LaneCycleOnReorderException)`.
- That action is wrapped in `action.transactionally`, and `ctx.withSystemContext` adds another `privilegedDb.run(action.transactionally)` (DbContext.scala:63-64). The failure therefore rolls the relink back; nothing commits as a `Left`.
- `PipelineStepWrites.reorderSteps` `.recover` maps the exception type to `ServiceError.BadRequest` before the generic `classifyDbError` arm, so the response is never a 500. `withSystemContext` does not wrap exceptions, so the typed match is reachable.
- `LaneCycleViolations.of` checks every step that has a lane reference, tails included. It uses the typed `configValue`, the same extractor input `PipelineRootWrites:194` uses. Its ancestor walk is cycle-safe.
- Only newly introduced `(step, target)` pairs block a reorder.
- `StepReorderLaneCycleRoutesSpec` covers: a 400 naming the step, the target and "ancestor", with `layout(pid) shouldBe before` (parent, root and position read from the DB), which is direct evidence of the rollback; a benign reorder (200); a pre-existing violation (200); and the permutation 422, which is kept.

**AC2: bare-position anchor (item 2).**
- `PipelineStepCreate.laneScopeF` now takes `prospectiveParent = anchor.anchor` from the same `StepPlacement.resolveCreateAnchor` result that `descendants` uses. The old guess is used only as a fallback when placement fails.
- `StepLanePositionAnchorRoutesSpec` uses trunk a->b->c plus tail t of a, inserting at position 2 (anchor t):
  - A lane to b gives 201 with `parentStepId == t`. The old code took ancestors from trunk-last c, so it answered 400.
  - A lane to t or a gives 400 and persists nothing.

**AC3: no existence probe (item 3).**
- `StepReferenceChecks.referenceChecksF` now evaluates `accessF` first. `laneScopeF` is by-name and is only forced inside `laneCheckF`, after access and ownership have passed.
- Create passes `pipelineAccessF`: `findByIdShared` gives 404, and `requireEditorAccess` gives 403 for a viewer.
- I audited the other create paths myself:
  - Patch-set create, apply-forward, rollback and undo all reach `pipelineService.addStep` (PatchSetApplyForward:99, PatchSetApplyRollback:248, PatchSetUndoService:281), so they use the same chain.
  - Patch-set resolve-time create runs `authorizeEditorOrOwnerOnPipeline` before anything else (PatchSetPipelineStepResolvers:206).
  - `PipelineCreatePreflight.laneChecks` is request-scoped (it only uses `byClientId`) and reads no stored steps.
  - I found no other insert caller outside the repository. MCP goes through the REST routes.
- `StepLaneAccessProbeRoutesSpec` asserts identical status and body for an existing step, the trunk-last step and a random UUID: 404 for a stranger and 403 for a viewer. `StepReferenceCheckDeferralSpec` counts zero step reads and zero root reads for a stranger.
- The evaluator's mutation (old chain order) turned these red: the stranger got 404/400/422. I did not repeat that mutation. The test structure directly distinguishes the three answers.

**AC4: rollback pin (item 4).**
- `PatchSetRollbackLaneStepSpec` pins the following outcome: edit 0 is `unrecoverable`, the referrer is gone, and the lane target keeps its parent.
- The `unrecoverable` status comes only from `addStep` returning `Left` (PatchSetApplyRollback:248-251), so the pin exercises the recreate-rejection path.
- The undo half is pinned by the pre-existing `PatchSetUndoLaneDescendantsSpec` (undo edit `failed`, target not re-parented). I ran it and it passes.
- The outcome matches the ticket's description.

**AC5: stale and cyclic (item 5). I ran an independent control probe.**
- In a throwaway detached worktree at 40abcbacc (now removed; `git worktree list | grep -c scratchpad` gives 0), I deleted only the line that makes the edit stale.
- The same edit then returned: `{"edits":[],"failure":"Lane reference '39f4fb42-…' would create a cycle (it is a descendant of this step)."} 200 OK was not equal to 409 Conflict`.
- So the edit really is cyclic, and the committed test's 409 `PATCH_SET_STALE` proves that staleness takes precedence. The pin is not vacuous.

**AC6: ownership dedup (item 6).**
- `grep -rn "secondaryDataSourceId(" backend/src/main/scala` returns only `PipelineStepConfigCodec.scala:114` (the definition) and `StepReferenceChecks.scala:75`.
- `checkOwnedSource` and both patch-set inline copies are deleted.
- The message texts are unchanged at each site: `Data source not found: <id>` and `edit <index>: data source not found: <id>`.

**Changed error precedence is safe.** Moving access first only replaces answers that came from data or structure with the pipeline-ACL answer (404/403). Every pre-access rejection that remains (unknown type, raw config problem, decode failure) is computed from the request alone and reads nothing from the pipeline. The two moved expectations in `StepReferenceCheckChainSpec` and the two in `StepReferenceCheckDeferralSpec` each carry a reason comment, and each new answer discloses less. No frontend or e2e code depends on the old ordering. The editor's reorder path (`usePipelineStepMutations.ts` catch block) reverts to `previousOrder` and shows a toast on any non-2xx response, so the new 400 is surfaced.

**Gates, re-run by me fresh on 40abcbacc:**
- Scoped `testOnly` of the 9 specs (the 8 touched or new, plus `PatchSetUndoLaneDescendantsSpec`): 51 succeeded, 0 failed, guard `failed=0 aborted=0`. Embedded Postgres started, so the tests really executed rather than coming from cache.
- Full `sbt testFull`, sharded 8 ways (`HELIO_TEST_SHARD_INDEX=0..7`, `HEL924_TEST_GROUP_CONCURRENCY=2`, `nice -n 19`, each shard in the foreground). Every shard exited 0 with guard `failed=0 aborted=0`.

  | Shard | Suites | Tests |
  |---|---|---|
  | 0 | 71 | 851 |
  | 1 | 73 | 1028 |
  | 2 | 74 | 885 |
  | 3 | 74 | 1040 (3 canceled) |
  | 4 | 74 | 705 |
  | 5 | 74 | 1131 |
  | 6 | 75 | 969 (1 canceled) |
  | 7 | 74 | 1166 |
  | **Total** | **589** | **7775 succeeded, 0 failed, 4 canceled** |

  This matches the evaluator's claimed totals exactly. The 4 canceled tests are the opt-in measurement tests.
- No frontend files changed (`git diff --stat` touches backend and openspec only), so there was no UI review and no servers were started.

**Bug-fix law.** The root causes are recorded with file and line evidence in design.md Context (re-verified on fe63a2518). Each behaviour change has a test that is red on the old code: AC2 and AC3 are red by construction of their assertions, and AC1 was confirmed red by the evaluator's mutation, which I cross-checked against the test logic.

No mtime-ordering evidence was relied on, so there is no gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes
- `LaneCycleViolations.of` is a second implementation of the direct lane-cycle rule; create and update still use `PipelineService.validateLaneReference`. HEL-1521 should converge them.
- `domain.pipelines.LaneCycleViolations` imports `api.protocols...PipelineStepConfigCodec`, so the domain layer depends on the api layer. There is precedent elsewhere, but it is still a layering smell.
- The reorder 400 message contains raw step UUIDs, which reach the editor toast. This is the same class of issue as item 7 and belongs in HEL-1542.
- `PatchSetRollbackLaneStepSpec` could cite `PatchSetUndoLaneDescendantsSpec` as the undo half of AC4.
- The AC5 test could embed the non-stale control I ran (expect a 200 with the cycle failure) so the "both" premise is self-proving.
- Residual READ COMMITTED race on reorder versus a concurrent step update. This is disclosed in design D1 and the code comment, and the run-time rejection is the backstop.

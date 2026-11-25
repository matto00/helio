## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `f0d21c75b52b982283b19482297fac1232260a8e` against live base `737adb3525afa48d2f75576f948221910b732f8d`.
Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1707/evidence/.concertino/scratch/HEL-1707/eval1/` (`c2-shard1.txt`, `c2-mut.txt`).

### Phase 1: Spec Review — PASS
Issues: none.
- Cycle 1 CR1 is resolved. The reorder race cases now send `Seq(t4, t2, t1)` (`PipelineGrantRecheckRaceSpec.scala:142`), a valid permutation of the trunk union {t1, t2, t4}. `red-run-addendum-reorder.txt` records both reorder cases on unmodified main as `Right(Vector(...))`, meaning the write landed, which is the reason D6 requires. The original `red-run.txt` is untouched, and `files-modified.md` records the correction.
- The other race requests are valid on main. In `red-run.txt`, every other route's red is the write landing: root add `Right(PipelineRootSummaryResponse)`, root remove `Right(RemovePipelineRootResponse(1,1))`, draft save and undo restore `Right(DraftSave...)`, attach and splice `Right(LimitStepResponse)`, update `Right(...LimitConfig(22))`, delete `Right(DeletePipelineStepResponse(0))`, duplicate `Right(LimitStepResponse)`. For root add 1(a) and 1(b) the red is the 500 cause (NoSuchElementException, FK violation), as the plan states.
- Constraints C1, C2 and C3 are still honoured. The only production change in this cycle is the import reorder in `DraftSaveTransaction.scala`.

### Phase 2: Code Review — PASS
Fresh gates, run in this worktree; the project-path lines name it:
- Shard of 34 suites, `failed=0 aborted=0`, 465 tests passed (`c2-shard1.txt`). It covers:
  - PipelineGrantRecheckRaceSpec
  - OutputDeleteCurrentAccessRlsSpec
  - PipelineRootEditorGuardsRlsSpec
  - PipelineRootWriteGrantsSpec
  - `*DraftSave*`
  - `*PatchSetUndo*`
- `check:scala-quality`, `check:openspec` and `format:check` all exit 0.
- The step, root and Output families passed in cycle 1 (shard4, 1308 tests). The production diff since then is an import reorder only, and it compiled in this cycle's run.

Independent mutation check, in a throwaway detached worktree at HEAD (removed afterwards), with m8 and m10 applied exactly as the evidence headers state:
- Reorder: both cases are red with `Right(Vector(LimitStepResponse(... t4 ..., t2 ...)))`. This is red for the right reason (write landed), not a 422.
- Output delete downgraded-creator case: `200 OK was not equal to 404`.
- Undo case: `Vector("restored") was not equal to Vector("failed")`. The new status assertion bites.

The mutation evidence files now each carry the one-line change applied, and their stated branches match the code at HEAD.

### Phase 3: UI Review — N/A
No UI-trigger paths changed.

### Overall: PASS

### Non-blocking Suggestions
- The new test "refuse (404, nothing deleted) a creator whose grant was fully revoked" (`OutputDeleteCurrentAccessRlsSpec.scala:34`) stays green under m10. The m10 evidence and my own run show 4 succeeded with this case among them. So the in-transaction re-check does not cause its 404; the earlier visibility/creator lookup already refuses a no-grant user on main. It is effectively a GUARD. Label it as one, or note in the PR body that the revoked-creator case was already 404 before this change. As written, its name implies it exercises R2.

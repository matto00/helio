## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `c5dd3e2053c5385b59cdcba8f72f333e4b97b0a7`, a merge of `origin/main` at `917c89172` (HEL-1720) into the branch. The review
base was resolved live with `resolve-review-base.sh`: `917c89172c1644a0bc08a4f55ec8bf413633bbff`. Since cycle 1 there are two new commits:
- `74f3495cb`: the cycle-1 fixes.
- `c5dd3e205`: the merge.

### Phase 1: Spec Review — PASS
Issues: none.

Cycle-1 change request 1 is resolved. `design.md` D5 now describes what shipped: the inline-root dry run runs at PREVIEW only
(`ctx.chargeFetches`), and apply keeps the inline-root checks inside `PipelineService.create`. It gives the reason (a second live
fetch, and `unavailable` for services built without a `SourceService`) and calls the choice C9-conservative.

Cycle-1 change request 2 is resolved. `check-inventory.md` section 6 now lists the step-update ordering change: with no patch,
the request gets a 400 before the existence or visibility check, on preview and apply alike, and the 400 reveals nothing.

The cycle-1 judgments on AC1 to AC5, the D7 skip and the edited existing specs still hold. The diff against the new base
touches the same 18 backend files as before. The only change since cycle 1 is two comment lines from `74f3495cb`.

### Phase 2: Code Review — PASS
Issues: none blocking.

The merge is clean:
- `git show --remerge-diff c5dd3e205` is empty, so the merge carries no manual conflict resolution and no hidden edits.
- HEL-1720 touched `OutputRepository`, `PatchSetUndoService`, `PatchSetUndoConflictCheck`, the new `PatchSetUndoBoundPanels` and the
  undo specs. None of those files is in this change's diff.
- The two changes can still interact at runtime: undo calls `PipelineService.addStep` and `updateStep`, which now run
  `checkAdd` and `checkUpdate`. The full re-run below exercises that.

Gates on the merged head, run fresh by me rather than taken from the executor's `post-merge.log`:
- **Test run:** `cd backend && sbt testFull` in 10 shards (`HELIO_TEST_SHARD_INDEX=0..9`, `HELIO_TEST_SHARD_COUNT=10`), with
  `SBT_OPTS=-J-Xmx3g`, `nice -n 19` and `ANTHROPIC_API_KEY` empty.
- **Result:** every shard exited 0 with `[hel1468-guard] failed=0 aborted=0`. In total, 10,152 tests passed, 0 failed and 5 were
  canceled (assumption cancels already present before this change).
- **Coverage:** this is the whole suite, not only the patchsets and pipelines packages. It includes:
  - `PatchSetUndoBoundOutputPanelsSpec`, new from HEL-1720
  - `PatchSetUndoLaneSpec`, which HEL-1720 changed
  - every other `PatchSetUndo*` spec
  - `PatchSetPreviewWriteParitySpec`
- **Logs:** `/home/matt/Development/helio/.concertino/scratch/HEL-1722/eval2-shard{0..9}.log`.
- **Other checks:** `npm run check:scala-quality` is clean (soft warnings only) and `check:openspec` is clean.

The new comments in `74f3495cb` cover cycle 1's two suggestions:
- the safety comment on the `findByIdInternal` call that bypasses access control (PatchSetPipelineStepResolvers.scala)
- the comment on the null audit service in `fromRepos`

### Phase 3: UI Review — N/A
No UI-trigger paths changed. The merge brings in no `frontend/**`, `schemas/**` or `ApiRoutes.scala` change from this branch.

### Overall: PASS

### Non-blocking Suggestions
- This is carried over from cycle 1. A step create with a lane input still reads the step list twice before `persistNewStep` (once in
  `laneScopeF`, once in `placementCheck`). One shared read would keep lane creates to design D1's "one extra read".

## Evaluation Report — Cycle 2, post-delivery re-check (evaluation-2.md)

Reviewed head: 59e89435f6bee2d7f8a6954afe115bd6ed7f9b0d. This is the merge of origin/main (HEL-1459 e56d94b10 and
HEL-1477 5a0701f0a) on top of squash c15aae8f7 and archive 88e5873b7. Cycle 1 (evaluation-1.md) passed 54dc271fc.

### Phase 1: Spec Review — PASS
- **Squash is faithful.** `git diff 54dc271fc c15aae8f7 -- backend` is empty. The only difference across the whole tree is two added
  openspec reports (evaluation-1.md, skeptic-final-1.md).
- **Archive is openspec-only.** `git diff c15aae8f7 88e5873b7` touches only openspec files:
  - the change dir moves to `archive/2026-10-11-normalise-restored-legacy-format/`
  - files-modified.md is dropped
  - `openspec/specs/patch-set-undo/spec.md` gains the requirement (+27 lines)
- **Spec content is correct.** `openspec/specs/patch-set-undo/spec.md` has a real Purpose paragraph that describes atomic,
  conflict-refusing undo, not a TBD placeholder. It contains "Requirement: Restored Output configs SHALL NOT reintroduce
  V118-repaired object-valued format" with all five scenarios, and the merge did not alter it.
- **The merge does not touch our code.** `git diff c15aae8f7 59e89435f` is empty for LegacyOutputFormat.scala,
  PatchSetUndoService.scala, OutputService.scala, PatchSetUndoDeadOutputKeysSpec.scala and the three new or hardened
  pipelines specs. HEL-1459 changed nearby patch-set code:
  - PatchSetTargetKinds
  - RefinementEditShape
  - PatchSetProtocol
  - schema guard specs

  HEL-1477 changed output-history retention and the scheduler. Neither touches the restore sites.

### Phase 2: Code Review — PASS
- **Targeted tests at the merged head** (`nice -n 19`, `-J-Xmx3g`, MemAvailable about 51 GB, no testFull running anywhere):
  - Command: `testOnly com.helio.services.patchsets.* com.helio.services.pipelines.* *PatchSetTargetKindsSchemaGuardSpec *PatchSetPreviewResponseSchemaSpec`
  - Result: 88 suites, 708 tests succeeded, 0 failed, 1 canceled.
  - The guard line shows: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
  - The run includes LegacyOutputFormatSpec, LegacyOutputFormatParitySpec, LegacyOutputConfigKeysParitySpec,
    LegacyOutputConfigKeysSpec, PatchSetUndoDeadOutputKeysSpec, and HEL-1459's PatchSetTargetKindsSchemaGuardSpec and
    PatchSetPreviewResponseSchemaSpec.
  - Evidence: `.concertino/runs/HEL-1441/evidence/eval2-merged-head-targeted.txt`.
- **No new code to review.** The product and test code is byte-identical to what cycle 1 reviewed.
- **Housekeeping:** the worktree was clean before and after the run, and no sbt process was left running.

### Phase 3: UI Review — N/A
No UI-trigger files changed in HEL-1441's own diff.

### Overall: PASS

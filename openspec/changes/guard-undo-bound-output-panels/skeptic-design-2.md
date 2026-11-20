## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 0167f9d0ea46f1eecc946cd6407b33e0443ffe10 (branch bug/undo-bound-output-panels/HEL-1720). The change directory is untracked at this HEAD (`git status` shows `?? openspec/changes/guard-undo-bound-output-panels/`), so the review covers the working-tree artifacts. The owner rulings (refuse with 409, all-or-nothing; name readable panels and count the rest; all four create arms; draft-save undo moved to HEL-1792) were taken as settled.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/undo-bound-output-panels/HEL-1720`.

- **Round-1 CR1 (removal set for the pipelineStep arm): addressed.**
  - D2 now defines the doomed set as `PipelineStepRepository.removalOf(stepId, rows).removed`, read through internal reads.
  - The spec delta's requirement text and a new scenario cover the descendant case. Task 4.1 adds the descendant test, and mutation 4.4(d) narrows the set to `node_step_id = step` and must go red.
  - Checked against the code. `PipelineStepRepository.scala:1113-1120` already has `removedByDeleteInternal(id)`. It runs under `withSystemContext` and uses the same `removalOf` as `deleteInternal` (lines 1060 and 1079). The design is implementable without new logic, and the executor should reuse this helper.

- **Round-1 CR2 (Output-arm window): addressed, and sound against the code.**
  - Current `deleteWithPanelsInternal` (`OutputRepository.scala:336-347`) runs these steps in one `.transactionally` block, at the default READ COMMITTED level:
    1. `lockForDeletion`
    2. `lockPipelines`
    3. `DELETE panels`
    4. `DELETE outputs`
  - D4 inserts `SELECT ... FOR UPDATE` on the Output and a re-count between steps 2 and 3.
  - Under READ COMMITTED, the FOR UPDATE waits for any in-flight FK KEY SHARE (an uncommitted bound-panel insert). A new statement then sees that panel once it commits, so the re-count catches it.
  - The existing `DELETE FROM outputs` already takes this same row lock at the end of the same transaction. The new lock therefore moves an existing lock earlier. It adds no new lock class or order, and the order stays panels, dashboards, pipeline, Output.
  - Panel create takes dashboard `FOR UPDATE` and then KEY SHARE through the insert (`PanelLayoutPlacement.scala:24-33`, `PanelRowLocks.scala:14`). That order is consistent with the delete's, so I see no deadlock. The design still requires the executor to confirm this (task 3.1).
  - Task 3.1's test now requires a second connection with an uncommitted bind, or a seam, which actually exercises the window. Mutation 4.4(e) guards it.
  - The fallback ("document the residual, do not claim closure") is stated.

- **Round-1 CR3 (log disclosure): addressed.**
  - D3 fixes the Phase-2 reason to a constant phrase plus a count, with no title, name or id.
  - Task 2.2 tests that string.
  - Checked against the code: `PatchSetUndoService.scala:104` logs `$reason` at ERROR. `safeRestoreOne` (line 111) also logs `ex.getMessage` for a thrown failure. The design says "typed failure", which keeps an exception message out of that path. See the non-blocking note.

- **Round-1 CR4 (residual for the three service-owned arms): addressed.**
  - D4 names the window precisely: from the re-check to the cascade, including an uncommitted bind in flight.
  - Task 3.2 requires the code comment to cite V130's RESIDUAL paragraph.

- **Round-1 non-blocking notes: all taken up.**
  - Dashboard-arm tests assert only that the panel-naming blocker is present.
  - The expected count is fixed at zero.
  - Lookups are capped at 10 or batched.
  - The pipeline-arm non-goal goes in the PR body.

- **Fresh review of D1 and D2 against the existing walk.**
  - `restoreAll` (`PatchSetUndoService.scala:88-108`) walks the edits in reverse and stops at the first failure, marking the rest `notAttempted`. A Phase-2 `failed` therefore protects every later (lower-index) delete. For example, a pipeline-create undo never runs after a failed Output-create undo.
  - `checkAll`'s arms (`PatchSetUndoConflictCheck.scala:57-63`) include `output`/`pipelineStep`/`pipeline`/`dashboard` `create`. D1's "add a blocker per arm" fits.
  - I re-traced the excusal cases from round 1 against the reworded D2: a set-created panel, a set-rebound panel with an off-resource priorState, a chain of updates, and a post-apply rebind caught by `checkPanel`. All still hold.
  - I also traced a set that creates a panel bound to O and then deletes it. The walk recreates the panel and then deletes it before O's undo. If ids ever diverged there, the Phase-2 re-count would fail safe (`failed`) rather than delete silently.

- **Ticket AC coverage.**
  - AC1 (never silently delete a panel created after the apply, or one another user owns): D2 covers all four arms, plus the D4 re-check. The scenarios cover the two-user, same-user, descendant, unreadable and mid-undo-bind cases.
  - AC2 (two-user test): red spec 1.1 is committed at 0167f9d0e (`PatchSetUndoBoundOutputPanelsSpec.scala` exists). Task 2.3 turns it green.

- **No placeholders or contradictions found.**
  - Task 4.3 has a "real path if one exists, else drive the helper directly and say so" branch. That is an explicit, reportable decision, not hand-waving.
  - The spec delta's "a bind during the undo" scenario is backed only for the Output arm. The other three arms carry the documented residual, and the spec scenario is worded for "a created Output", so it is consistent with D4.

### Verdict: CONFIRM

### Non-blocking notes

- The D4 Output-arm abort should return a `Left` with the fixed phrase. It should not throw an exception whose message reaches `safeRestoreOne`'s `ex.getMessage` log path (`PatchSetUndoService.scala:111`). If the executor implements it as a thrown typed exception, its `getMessage` must be the same fixed phrase.
- A panel bound to an Output that the set created on a pipeline the set also created will be reported by both the `output` and the `pipeline` arm blockers. The 409 message joins blockers with `"; "`, so that panel is named twice. This is harmless but noisy. The executor may dedupe it, or a test can simply tolerate it.
- Reuse `PipelineStepRepository.removedByDeleteInternal` for the pipelineStep doomed set instead of re-reading rows by hand. It is the existing drift-proof helper.
- The change directory was still uncommitted at review time. Commit the artifacts with the implementation as usual.

## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD a27a2d04dcfef52ccc84a9db4721b5a4b3c97e2f against live-resolved base 83e5655e4913d716e51e4f51919a567f058bac52 (`resolve-review-base.sh`, exit 0). Spawn-cwd guard: READY.

### What I verified (with evidence)

- **Red first.** `git diff --stat 83e5655e4 568275715` lists only the new spec `PatchSetUndoLaterAlertRulesSpec.scala`, `red-run.txt` and planning artifacts. No `src/main` file changed. `red-run.txt` is in that commit and shows 6/8 failing on the undo-succeeds path (`Right(...restored...)`). The `pipelineStep` case was refused only by the HEL-1795 Output blocker, with no rule clause. The spec's first test asserts `rolbypassrls = false` on the `helio_app_test` role, and it passes in my run.
- **Fix: whole undo refused with 409, nothing changed.** `PatchSetUndoConflictCheck.guarded` (line 62) calls `PatchSetUndoLaterChildren.blockers` in Phase 1. `guards` now also covers `output`. `blocking` adds alert rules on every doomed Output (all three arms), plus the schedule and non-excused roots (pipeline arm only). The tests check `Conflict` and that the rule, Output, pipeline, schedule and roots all still exist. `PatchSetUndoRoutesSpec` adds a REST 409 test that names the rule, is not `PATCH_SET_STALE`, and leaves the rule row in place.
- **Naming rules.**
  - Alert rules are named only when `findVisibleAlertRuleIds` (filtered by owner) returns them; the rest are shown as "N alert rule(s) you do not own". The unowned-rule test checks that neither the rule's name nor its id appears.
  - Roots are named through `DataSourceRepository.findByIdOwned`. `DataSourceRepository` has no sharing-aware by-id read (I listed its `def find*`), so this is the conservative reading of "readable": it can only count more roots, never leak a name. The editor-root test checks that B's source name and id are absent.
  - The schedule message carries no expression and no id.
  - The Phase-2 phrases `addedDuringUndo` and `outputBoundDuringUndo` are counts only. The only ERROR log is the existing `undo restore failed` line, which carries that count phrase, and the re-check test checks that the rule's name and id are absent from it. No new INFO/WARN log with an id: the only log line in the diff is the existing capture-failure WARN, which logs an exception class.
- **Only what the patch set created is excused.**
  - Patch sets cannot create alert rules or schedules. `schemas/patch-sets/*.json` has no alert or schedule mention, `CreatePipelineRequest` has no schedule field, and a pipeline `update` changes only the name (`restorePipelineUpdate` -> `updateName`). So no same-set create can be wrongly blocked.
  - Roots are excused by the journaled `rootIds` (`PatchSetApplyService` captures them from `listRootDataSourceIdsInternal` right after the create). A legacy journal row falls back to `created_at <= appliedAt`.
  - The applier's own later rule blocks (first test).
- **Phase-2 re-check.**
  - Pipeline and step arms: `ifStillUnbound` (PatchSetUndoService:161-164) re-runs `blocking`. The extended `Later.isEmpty`/`size` covers the new kinds, and the test "report the pipeline edit failed..." holds a lock, inserts a rule after Phase 1, and gets `failed` with the rule intact.
  - Output arm: `deleteIfUnboundInternal` now counts `alert_rules` inside the locked transaction and returns `Left((panels, rules))`.
- **Mutations genuinely go red.** I read the executor's `mut.py`: the six substitutions remove real behavior, and the source is restored afterwards (the worktree is clean apart from the untracked `evaluation-1.md`). I independently reproduced the core mutation in a `git archive` copy under scratch, outside the worktree. Replacing `rules` with `Vector.empty` in `Later(...)` gives 5 failed and 8 succeeded, identical to `mutations-run.txt`.
- **DraftRestore output unchanged.** `alertRuleClause` is the removed expression moved verbatim: same partition, same `ruleNames`, same "and" joining, same `.filter(_.nonEmpty)`. The input is still sorted by id, and the extra re-sort is idempotent. `DraftUndoPanelNamingSpec` passes in my run.
- **PatchSetUndoService change is minimal.** It is one match arm (line 147), matching C10 and leaving the tidy to HEL-1797.
- **REST, helio-mcp and toast wording.** `patchSetsSlice.ts:306-310` passes `response.data.message` through to the toast, and the helio-mcp undo handler returns the conflict verbatim. Neither matches on phrase text. A repo-wide grep for the changed phrases finds them only in backend code, tests and change docs.
- **Fresh gate run (mine):** `nice -n 19 sbt -J-Xmx3g testOnly PatchSetUndoLaterAlertRulesSpec PatchSetUndoLaterOutputsSpec PatchSetUndoRoutesSpec PatchSetUndoLaneSpec *DraftUndoPanelNamingSpec`, run with `DATABASE_URL` set to helio_hel1811 and an empty `ANTHROPIC_API_KEY`. Result: exit 0, 5 suites, 43 tests, 0 failed (output in `.concertino/scratch/HEL-1811/skeptic-run1.txt`). The evaluator's broader shards (136 + 164 + 155 tests) are pasted with counts, and their logs are in scratch.
- **UI:** none. The change is backend-only and no frontend file changed, so step 4 does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- `PatchSetApplyService`'s capture-failure WARN still says "steps and Outputs", although the capture now records roots too.
- The arrow alignment in `PatchSetUndoBoundPanels.doomedOutputIds` is irregular (cosmetic).
- The multi-root excusal test uses existing-source roots only. Inline roots go through the same `listRootDataSourceIdsInternal` capture, so they should be covered, but no test exercises them.

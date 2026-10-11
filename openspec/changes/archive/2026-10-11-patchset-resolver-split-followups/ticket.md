# HEL-1482: PatchSet resolver split follow-ups: stale citations, existence-row labels, test gaps

## Description

These follow-ups came from HEL-1479 (matto00/helio#931, dae4bc451), which split `PatchSetApplyResolvers.scala` into five target-kind objects with no behaviour change. Its PR rules forbade comment and test edits, so everything below was left out. The paths and line numbers are from the lane's report; re-derive them from main before editing.

**Comment-only**

1. Prose mentions of members that moved now point at the wrong place:
   * `PatchSetPreviewProjection.scala:355`
   * `PatchSetUndoService.scala:245-246`
   * `RefinementEditShapeSpec.scala:31`
   * `PatchSetPreviewServiceSpec.scala:504`
2. Inside the moved resolver code: positional words ("above", "below"), doc links, and `PipelineService` citations that no longer point at the right place.
3. `PipelineProtocol.scala:60` cites `PipelineService.resolveInlineOrExistingRoot`, which has never existed. This predates HEL-1463.

**Test metadata**

4. The four output rows of `ExistenceNotLeakedRoutesSpec` still name `PatchSetApplyResolvers.scala` in `sites`, but the owner check now lives in `PatchSetOutputResolvers.scala`. Only the label is wrong: `sites` feeds the access-helper completeness check, and what turns a row red is the foreign-vs-absent probe (HEL-1480 finding). Repoint the rows, and show each one still turns red when a foreign id gets through.

**Coverage gaps the mutations exposed (each new test must fail against a mutation first)**

5. No spec asserts the `requireTargetId` BadRequest message.
6. The `decodeCreatePatch` error messages were never probed.
7. Weakening the editor-grant branch of `authorizeEditorOrOwnerOnPipeline` left the targeted specs green. That gap existed before HEL-1479. It is access control, so treat it as the priority item in this ticket.

**Optional**

8. `PatchSetPipelineStepResolvers.scala` is 264 lines, against a ~250 soft budget; the HEL-1479 design accepted that.
9. Evidence-script nits in HEL-1479's archived move-check:
   * `grep-guards.sh` does not fail when `BASE` is unset.
   * The per-suite canceled column in `suites.py` reads 0, though the logs report 4 canceled.

Do not change behaviour. If a test exposes a real bug, file it as its own ticket.

## Acceptance Criteria

- Items 1-3: every listed stale citation (and every stale positional word / doc link / `PipelineService` citation found by the sweep inside the six resolver files) corrected, symbol + file, no line numbers; sweep recorded hit by hit.
- Item 4: the four output rows name `PatchSetOutputResolvers.scala`; each row shown RED under a mutation that lets a foreign id through, then GREEN.
- Items 5-7: new tests asserting the `requireTargetId` message, the `decodeCreatePatch` messages (missing patch, undecodable patch), and the editor-grant / viewer-grant branches of `authorizeEditorOrOwnerOnPipeline` (and any other editor-grant path found with the same gap); each new test shown RED against a one-line mutation of the branch it guards, then GREEN.
- If a test exposes a real authorization defect, stop and escalate to the owner (do not fix silently); any other real bug becomes its own ticket.
- No behaviour change in main code (comment edits only).
- Items 8-9: an explicit recorded decision.

## Driver constraints

- Sbt runs: `-batch -J-Xmx3g`, output shows `[hel1468-guard]`, no sbt server left running; check `free -g` (>= ~15 GB available) before heavy runs and commits.
- New spec files use `VerifiedEmbeddedPostgres.start`; no inline FQNs.
- PR body/commits carry no claude.ai session link and no Claude-Session trailer.

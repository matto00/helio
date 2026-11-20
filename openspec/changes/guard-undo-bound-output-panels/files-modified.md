- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoBoundPanels.scala` — new shared bound-panels check (doomed minus set-created panels, readable-named blocker message with cap and unreadable count, fixed Phase-2 phrase)
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoConflictCheck.scala` — Phase-1: the four create arms add the shared blocker alongside their own check
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoService.scala` — Output arm uses the guarded delete; pipelineStep/pipeline/dashboard arms re-check right before the delete
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala` — `deleteIfUnboundInternal` (same locks, Output row FOR UPDATE, in-transaction recount, Left(n) with nothing written)
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoBoundOutputPanelsSpec.scala` — red spec turned into 7 cases on helio_app_test (two-user duplicate path, same-user, clean undo, in-flight bind window, dashboard, pipeline + unreadable count, pipelineStep descendant)
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoLaneSpec.scala` — the lane-create undo test bound a panel after apply and expected it cascaded away; now expects the refusal, then the clean undo once the user deletes the panel
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoBoundPanels.scala` (cycle 2) — dead code removed: unused imports, and `doomed` now returns only panel ids
- `openspec/changes/guard-undo-bound-output-panels/**` — proposal, design, spec delta, tasks (ticked), skeptic design reports, this file

## 4.5 MCP description and web toast

- `helio-mcp/src/tools/refinement.ts` `undo_patch_set`: "if any touched resource changed since the apply ... the whole undo is refused and nothing is touched". A resource that gained panels has changed since the apply, so the wording stays accurate. No change.
- Web: `undoPatchSet.rejected` stores the server's message in `undoError` (`action.payload`, the axios-unwrapped server message), so the 409 naming the panels is what the user sees. No change.

## 3.1 Deadlock check

- Reasoning: `deleteIfUnboundInternal` keeps `deleteWithPanelsInternal`'s order (panel rows by id, then dashboards, then the pipeline row, then the Output). The new `SELECT ... FOR UPDATE` on the Output row only takes earlier the row lock the final `DELETE FROM outputs` takes anyway. Draft save takes the pipeline row first, as this delete does (HEL-1629); a panel create takes dashboard FOR UPDATE then the FK key-share on the Output, the same order, so the delete waits for it rather than cycling.
- Evidence: the "bind commits after the Phase-1 check" test holds an UNCOMMITTED panel insert (key-share on the Output), starts the undo, shows the undo parked on the Output row lock (not completed after 1.5 s), commits, and the undo finishes without a deadlock (40P01) as `failed`, with the panel and Output intact. I did not run a concurrent draft-save test; that part rests on the lock-order reasoning above.

## Deviations from the design

- D2 point 2b (excusing a `panel` `update` edit whose prior binding is off the doomed Outputs) is NOT implemented. The doomed resource is created by the same set, and only a panel create can name a `$ref` (an update cannot bind to an id that does not exist before the apply), so no pre-existing panel can be moved onto it by an update; the excusal is unreachable, and blocking is the safe direction. The code comment says so. Consequence for task 2.1: only the created-panel excusal and "a later panel is never excused" are tested; the rebind-excusal test could not be built (an apply of `$ref` in a panel update is refused).
- Task 4.3: a real path exists (B, editor on A's pipeline, creates an Output and binds it on B's own dashboard; A undoes the pipeline create), and the test uses it.
- The first mutation 4.4(c) survived (a weak mutation); it was strengthened and then went red. Recorded in mutations.txt.
- No migration (V147 untouched).

## Cycle 2 (evaluation-1.md)

- Artifacts now describe the shipped rule: spec.md, proposal.md and design.md D2 say only panels the set itself created are excused; the panel-update excusal is recorded as not implemented, with the reason.
- Task 2.2 Phase-2 reason: the window test and a new pre-delete re-check test capture the `PatchSetUndoService` ERROR log and assert it holds the fixed phrase and a count, and not the panel id, the panel title or the Output id.
- Task 3.2: new test "report the edit failed ... after the Phase-1 check (the pre-delete re-check)" reaches the blocking branch of `ifStillUnbound` (dashboard arm) without a production hook: a second connection holds an Output row lock to park the walk after Phase 1, a panel then commits on the set's dashboard, and the dashboard edit comes back `failed` with the panel and dashboard intact. Mutation (f), removing the re-check, turns it red (mutations.txt). The pipelineStep and pipeline arms share the same `ifStillUnbound` wrapper but are not separately driven.
- Stale `PatchSetUndoLaneSpec` title renamed.
- Not done (non-blocking): no concurrent draft-save test; no split proposal for `PatchSetUndoService.scala` (402 lines); `removedPlacementCount` is now almost always 0 (follow-up candidate).

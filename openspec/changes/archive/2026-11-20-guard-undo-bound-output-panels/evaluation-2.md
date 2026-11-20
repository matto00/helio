## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: b07f487642894e1e3ac011713c0ac576e9d971cc. This is the cycle-2 commit b07f48764, on top of bec60a608. The base, eb0521f00, was resolved live. I reviewed the incremental diff bec60a608..HEAD in full.

### Phase 1: Spec Review — PASS

Every evaluation-1 change request is resolved. I checked each one against the code:

- **CR1 (dead code): done.**
  - `PatchSetUndoBoundPanels.scala` no longer imports `spray.json.JsString` or `scala.util.Try`.
  - `doomed` now returns `Future[Vector[String]]`.
  - Its caller, `blockingPanelIds`, maps over the panel ids directly.
  - Behaviour is unchanged.
- **CR2 (artifacts describe the shipped rule): done.**
  - The spec delta's Requirement paragraph now says "Only panels the same patch set itself created (its `panel` `create` edits) are excused".
  - `proposal.md` bullet 3 drops the rebind clause.
  - `design.md` D2 point 2 records the panel-update excusal as not implemented, with the `$ref` and resolve-time reasoning.
  - The Risks entry and task 2.1's Verify text now match.
- **CR3a (Phase-2 reason asserted): done.**
  - Both the window test and the new re-check test attach a logback `ListAppender` to `PatchSetUndoService`'s logger.
  - Each asserts that the ERROR line contains "1 panel(s) were bound during the undo; nothing further was undone".
  - Each also asserts the line does not contain the panel id or the panel title. The window test also checks for the Output id.
  - The appender is detached in a `finally` block.
- **CR3b (the blocking branch of `ifStillUnbound` is reached): done.**
  - The new test uses a set made of a dashboard create (edit 0) and an Output create (edit 1).
  - A second connection holds `FOR UPDATE` on the Output row, which parks the reverse walk at the Output delete. By that point Phase 1 has passed.
  - A panel is then committed onto the set's dashboard, bound to a pre-existing Output, so it touches nothing the holder has locked.
  - The holder then rolls back. The Output delete completes, and the dashboard arm's pre-delete re-check finds the panel.
  - So the test reaches `ifStillUnbound`'s blocking branch with no production hook.
  - Mutation (f) in mutations.txt removes the re-check, and this test goes red.
  - As files-modified.md discloses, the pipelineStep and pipeline arms share the same one-line wrapper (`PatchSetUndoService.restoreOne`) but are not driven separately. Since the wrapper and `blockingPanelIds` are shared, I accept that.
- **CR4 (stale lane-spec title): done.** The title now describes the refusal and then the clean undo.

**The partial outcome is correct.** The CR3b test ends with the Output edit `restored` and the dashboard edit `failed`. That is what the existing requirement "An unforeseeable restore failure SHALL report an honest partial outcome" (`openspec/specs/patch-set-undo/spec.md:77-89`) asks for:

- The failure could not have been detected before the restore: the panel landed after Phase 1 passed.
- The walk stops at that edit. Edit 0 is the last edit in the reverse walk, so no edit is left to mark `notAttempted`.
- The edit already restored, the Output delete, is not reversed. That delete was legitimate in its own right: the Output carried no panels the set did not create, and its own in-transaction recount confirmed that.
- Nothing the set did not create was deleted. The late panel and the dashboard survive, and the test asserts both.
- The response reports the failed edit as `failed`, not `restored`.

Owner ruling C1 (all-or-nothing) governs only the Phase-1 refusal path, and that path is unchanged. This Phase-2 race is the documented D4 residual, and it fails closed for the dashboard.

Constraints C1 to C4 are still honoured. The cycle-2 diff changes no behaviour.

### Phase 2: Code Review — PASS

I re-ran these gates myself, with an empty `ANTHROPIC_API_KEY`, `sbt -J-Xmx3g` and `nice -n 19`:

- `testOnly com.helio.services.patchsets.PatchSetUndo* com.helio.api.routes.patchsets.* PatchSetOutputCreateSpec PatchSetRollbackLaneStepSpec`: 246 of 246 passed.
  - This includes the 8 cases of `PatchSetUndoBoundOutputPanelsSpec`, among them the new "(the pre-delete re-check)" test.
  - It also includes the renamed lane test.
- `testOnly PatchSetApply* PatchSetAppliedProposalsRlsSpec PatchSetDashboardGrantSpec PatchSetInlineRootRollbackSpec PatchSetInsightOutputSpec PatchSetPipelineStepGrantSpec Hel914Ac1EndToEndSpec OutputRepositoryRequiredSpec DraftSaveUndoSpec DraftSaveRootsUndoSpec`: 113 of 113 passed.
- `npm run check:scala-quality`, `check:openspec` and `format:check` are clean. scala-quality reports only soft-budget warnings: the spec file is now 355 lines.
- I did not run the full `sbt testFull`, because it does not fit the 600 s timeout. I sharded it as in cycle 1. The preview and refinement specs, which this change does not touch, were not run.

Code observations:

- The test-only logback imports (`ch.qos.logback.classic.*` and `org.slf4j.LoggerFactory`) are top-of-file imports, so there is no inline FQN.
- The `sqlu` insert in the new test uses bound parameters.
- No new dead code.

Cycle 1's judgments still stand:

- Deviation 1 (dropping the panel-update excusal) is sound.
- The lane-spec expectation change is justified.
- The lock-order no-deadlock argument for the Output arm is accepted.
- Disclosure, the `helio_app_test` wiring and the helio-mcp and web-toast accuracy are all verified.

### Phase 3: UI Review — N/A

The diff does not touch `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- **Stale comment in `PatchSetUndoLaneSpec.scala:84-86`.** The comment above the renamed test still says the undo "removes the step, its bound Output, AND that Output's placement (panel) atomically ... and reports the placement count". Update it to match the new title.
- **Carried over from cycle 1.** files-modified.md acknowledges each of these:
  - The PR description should propose a split of `PatchSetUndoService.scala` (402 lines; see CONTRIBUTING.md:24).
  - Consider a follow-up for `removedPlacementCount`, which is now almost always 0.
  - A concurrent draft-save test is still missing.
  - The PR body should state the remaining race window on the step, pipeline and dashboard deletes (V130 RESIDUAL). It should also state that a pipeline-create undo still deletes Outputs other users added, though their panels are protected.

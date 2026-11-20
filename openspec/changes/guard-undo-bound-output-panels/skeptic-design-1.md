## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 0167f9d0ea46f1eecc946cd6407b33e0443ffe10 (branch bug/undo-bound-output-panels/HEL-1720). The owner rulings (refuse 409 all-or-nothing, name readable panels and count the rest, all four create arms, draft-save undo to HEL-1792) were taken as settled. This review covers only whether the design implements them soundly.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/undo-bound-output-panels/HEL-1720`.
- **Red evidence is real:** `.concertino/runs/HEL-1720/evidence/red-run.txt` shows both tests in `PatchSetUndoBoundOutputPanelsSpec` failing (`failed=2`, `exit=1`), with the undo returning `Right(... restored ...)`. Mutation A shows the `panels.output_id` cascade still deletes the panels, so the guard has to stop the resource delete itself. That matches D4's premise. The spec runs on `helio_app_test`, and B's copy is made through `appPanels.duplicate` (spec lines 136-158).
- **Premise correction holds:** `PanelBindingChecks.rejectMissingOutput` (PanelBindingChecks.scala:41-51) calls `outputRepo.findByIdOwned`, which filters on `r.ownerId === user` (OutputRepository.scala:224-229). A grantee therefore cannot bind A's Output through create or update. `PanelMutationRepository.duplicate(id, ownerId, ...)` takes the duplicator as the owner.
- **Current undo path:** `PatchSetUndoService.undo` runs Phase 1 `checkAll`, then `restoreAll`, a reverse walk that stops at the first failure and marks the rest `notAttempted`. `checkOutputCreate` only checks that the Output exists. `checkPipelineStepCreate` only checks lane secondaryInput references. Neither looks at bound panels. D1 fits this shape.
- **D2 excusal rule against the reverse walk.** I traced these cases by hand:
  - A panel created by the set is excused, and its create edit has a higher index than the resource create, so the reverse walk deletes it first.
  - A panel created by the set and later rebound outside the set to a different doomed Output is caught by its own `checkPanel` config comparison (create arm), so it blocks.
  - A set-created panel that the set itself rebound from O1 to O2: the update and create undos both run before either Output delete. Sound.
  - A pre-existing panel the set rebound to a created Output: its update edit's index is necessarily above the create (the bind needs the Output to exist), and its priorState binding is not doomed, so it is restored off the Output first. Sound.
  - A chain of two updates (P to X, then P to O, with X and O both doomed in the pipeline arm): the first update's priorState is not doomed, so P is excused through the union over edits. Sound.
  - A post-apply rebind of a panel the set updated is caught by `checkPanel`.
  - If restoring the panel update fails in Phase 2 (for example, A lost editor access), the walk stops before the resource delete.
  The excusal rule itself is sound as written.
- **The pipelineStep doomed set is wrong (see CR1).** `PipelineStepWrites.deleteStep` calls `PipelineStepRepository.deleteInternal`. That removes `PipelineStepRepository.removalOf(...).removed`, which is the step plus `tailDescendants`: every child except the promoted head child, with their whole subtrees (PipelineStepRepository.scala:1457-1467). Its own panel pre-lock covers `steps = preRemoval.tailDescendants + preRow.id` (lines 1066-1072). The Outputs on those tail steps cascade away with their panels. D2's arm definition, "panels bound to any Output whose `node_step_id` = the step", misses all of them.
- **The Output arm still has a race (see CR2).** `deleteWithPanelsInternal` (OutputRepository.scala:336-347) calls `PanelRowLocks.lockForDeletion(outputs = ...)`, then `lockPipelines`, then `DELETE FROM panels WHERE output_id = ANY(...)` and `DELETE FROM outputs`. `hel1498_lock_panels` (V129, and V130 per its header) locks existing panel rows, their dashboards, and `p_dashboard_ids`. It never locks the Output row or rows that do not exist yet. A concurrent panel create on a dashboard holding no panel bound to O is therefore not blocked. Per V130's header, a create locks its dashboard and then takes KEY SHARE on O through the FK. Two outcomes follow:
  - If the create commits after D4's re-count, the explicit panel `DELETE` removes it.
  - If it is still in flight, `DELETE FROM outputs` waits on the KEY SHARE and then the cascade deletes the panel.
  V130's own RESIDUAL paragraph documents this exact "create committing between this function and the DELETE" window. So "re-count after `lockForDeletion`" does not make the Output delete race-free, although D4 presents it as closed.
- **D3 disclosure:**
  - `PanelRepository.findById(id, Some(user))` (PanelRepository.scala:145+) admits only the dashboard owner or a dashboard grantee, so a readable panel is one the undoer can already see. Naming it leaks nothing.
  - The count of unreadable panels does reveal that unseen panels exist, but the owner explicitly ruled for that.
  - One gap is in the logs. `restoreAll` logs every Phase-2 failure `reason` at ERROR (`log.error(s"undo restore failed ...: $reason")`). D4's Phase-2 failures will flow through it, and D3's no-leak rule is not stated for that path (see CR3).
- **Spec delta against the AC:**
  - The requirement text ("a panel bound to any Output that the delete would remove") is broad enough to cover tail steps. The design is what narrows it.
  - Scenarios cover the two-user case, the same-user case, set-created panels, an unreadable panel, and the other arms in general.
  - No scenario covers the rebind excusal (only task 2.1 does), and none covers a tail-step Output (see CR1).
  - The ticket's second AC (a test of the two-user case) is met by 1.1 plus task 2.3.

### Verdict: REFUTE

D2's doomed set for the `pipelineStep` arm leaves out panels the step delete actually removes, so that arm would still delete them silently. That is a direct miss of AC 1 inside the scope the owner ruled in. D4 also claims to close the Output arm's window but does not specify the lock that would close it.

### Change Requests

1. **D2, `pipelineStep` arm: use the delete's real removal set.**
   - Change the arm to: panels bound to any Output whose `node_step_id` is in `PipelineStepRepository.removalOf(stepId, rows).removed`, meaning the step plus `tailDescendants`. This is the same pure function `deleteInternal` and its pre-lock use (PipelineStepRepository.scala:1060-1072).
   - Read the pipeline's step rows through an internal read, so other users' steps and Outputs are seen.
   - Apply the same set in the Phase-2 re-check (D4) and in the priorState "doomed Outputs" comparison.
   - Add to the spec delta and to task 4.1 a scenario and test: after the apply, a second child (a tail) is added under the set-created step, an Output is created on it and a panel is bound. Undo must be refused, and the tail step, the Output and the panel must survive.
   - Add a mutation to 4.4: narrow the doomed set to `node_step_id = step` only, and that test must go red.

2. **D4, Output arm: specify the lock that actually closes the window, or downgrade the claim.**
   - Inside `deleteWithPanelsInternal`'s transaction, after `lockForDeletion` and after `lockPipelines`, take `SELECT 1 FROM outputs WHERE id = O FOR UPDATE`. This must happen after the pipeline lock, to keep the HEL-1629 order the file comments describe. That lock conflicts with the FK's KEY SHARE, so it waits for any in-flight bind to commit. Only then re-count bound panels against the excused set, and abort on a non-empty result.
   - The order matches V130 (panels, then dashboards, then the Output). The executor must confirm there is no deadlock against draft save (pipeline row first) and against panel create (dashboard, then KEY SHARE on O).
   - Rewrite task 3.1's test so it actually exercises the window. A pre-delete "direct call" bind is not enough: it needs a second connection that has inserted a bound panel and not yet committed (or a test seam between the re-count and the delete), and an assertion that the panel survives and the edit reports `failed`.
   - If the executor finds that this lock cannot be taken safely, D4 must state that the Output arm keeps the same documented residual as the other three. It must not claim closure.

3. **D3/D4, log disclosure: extend the no-leak rule to Phase-2 failure reasons.**
   - The reason string for a D4 Phase-2 `failed` outcome is logged at ERROR by `restoreAll`. State in D3 that this string carries no title, dashboard name or id of a panel the undoer cannot read. The simplest version is a fixed phrase plus a count.
   - Add an assertion to the 2.2 test, or a sibling test, that covers that path.

4. **D4, residual for the three service-owned arms: accepted, with conditions.**
   - Accepting the one-statement window is reasonable. It is the same class as V130's and HEL-1485's accepted residuals, and threading a guard DBIO through three service-owned transactions is out of proportion for this bug.
   - The design must name the window precisely. It runs from the Phase-2 re-check to the cascade, and given CR2's analysis it also covers an uncommitted bind that is in flight during the delete.
   - Task 3.2's code comment must cite V130's RESIDUAL paragraph, so the same residual is not documented twice with different wording.
   - No guard parameter is required.

### Non-blocking notes

- For the dashboard arm, the existing `checkDashboard` layout comparison may already raise a "dashboard ... was changed" blocker when a panel is added after the apply. The 409 would then carry both blockers. The test should assert that the panel-naming blocker is present, not that it is the only one.
- D4 says both "the delete accepts the excused panel set" and "the expected count is zero" for the Output arm. Pick one. Zero is correct, since by then the set's own panels are gone and rebound panels are restored, and it is simpler.
- In D3, the per-panel readability lookups run once per blocking panel. The design caps the number of names, but not the number of lookups. Cap the lookups too, or batch them.
- The pipeline-arm non-goal is fine: Outputs that other users added to a set-created pipeline are not protected, only their panels are. The PR body should still say so plainly, because that undo silently deletes another user's Outputs.

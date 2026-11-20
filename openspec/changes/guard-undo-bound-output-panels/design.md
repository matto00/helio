## Context

See proposal.md for motivation. Owner rulings (HEL-1720 escalation, answered 2026-11-20 via chat): refuse with 409, all-or-nothing; name only panels the undoing user can read and count the rest; one shared check across the `output`, `pipelineStep`, `pipeline` and `dashboard` create undo arms; draft-save undo is HEL-1792.

Current state:
- `PatchSetUndoService.undo` runs `PatchSetUndoConflictCheck.checkAll` (Phase 1) over every journaled edit. Any blocker refuses the undo with `ServiceError.Conflict(blockers.mkString("; "))` → 409, and nothing is restored. Phase 2 (`restoreAll`) walks the edits in reverse.
- Undo is authorised only to the applying user (`PatchSetApplicationRepository.findById` filters on `owner_id`).
- The delete paths: `output` create → `OutputRepository.deleteWithPanelsInternal` (privileged pool, `withSystemContext`); `pipelineStep` create → `PipelineService.deleteStep`; `pipeline` create → `PipelineService.delete`; `dashboard` create → `DashboardService.delete`. Panels go via explicit `DELETE` and/or FK cascades (`panels.output_id`, `outputs.node_step_id`, `outputs.pipeline_id`, `panels.dashboard_id` all `ON DELETE CASCADE`). FK cascades ignore RLS.
- Red evidence (commit 0167f9d0e): mutation A (skip only the explicit panel `DELETE`) still deletes the panels through the cascade. Mutation B (skip the Output delete) passes. The guard has to stop the resource delete itself.
- Premise correction: a grantee cannot bind another user's Output through `PanelService.create`/`update` (`PanelBindingChecks.rejectMissingOutput` → `findByIdOwned`). The reachable cross-user case is `PanelService.duplicate`. An editor on the dashboard copies a bound panel, and the copy's `owner_id` is the duplicating user.

## Goals / Non-Goals

**Goals:**
- No create-arm undo deletes a panel the patch set did not create, whoever owns it. The undo is refused instead, whole.
- The refusal names readable panels and counts unreadable ones.
- The two-user case is proven on the non-BYPASSRLS app role `helio_app_test`.

**Non-Goals:**
- Draft-save undo (HEL-1792).
- Protecting Outputs (as opposed to panels) that another user added to a pipeline the patch set created. The ticket's AC and the owner ruling are about panels. Any such Output's panels ARE covered, because they are deleted with it.
- Any change to the response schema, the REST route, helio-mcp or the web client.

## Decisions

### D1. A Phase-1 blocker, not a new outcome tier
The check is added as a blocker in `PatchSetUndoConflictCheck` for the four create arms. It reuses the existing 409 / nothing-restored path. Alternatives (partial undo, confirm-then-delete) were rejected by the owner. The helio-mcp `undo_patch_set` description ("if any touched resource changed since the apply ... the whole undo is refused and nothing is touched") stays true. A resource that gained panels has changed since the apply. The executor SHALL re-read that description and report whether its wording still covers this case. Any wording change is out of scope unless it is plainly false.

### D2. One shared "panels bound since the apply" computation
A single helper (e.g. `PatchSetUndoBoundPanels`) takes the doomed resource and the whole edit list, and returns the blocking panel ids:
1. **Doomed panels** (privileged/internal reads, because the check must see other users' panels):
   - `output` create: panels with `output_id` = the Output.
   - `pipelineStep` create: panels bound to any Output whose `node_step_id` is in the delete's real removal set, `PipelineStepRepository.removalOf(stepId, rows).removed` (the step plus every non-promoted child subtree). This is the same pure function `deleteInternal` uses. The pipeline's step rows and Outputs are read through internal reads, so steps and Outputs other users added are seen. (Skeptic design r1 CR1.)
   - `pipeline` create: panels bound to any Output of the pipeline.
   - `dashboard` create: panels on the dashboard.
2. **Excused panels**, derived from the same application's edits:
   - the `newId` of every `panel` `create` edit, which the reverse walk deletes first;
   Nothing else is excused. A `panel` `update` edit's target is deliberately NOT excused (the originally designed "rebound onto a binding outside the doomed resources" rule is not implemented). The doomed resource is created by this very set, and a panel update cannot name a `$ref` (only a panel create can), nor can any id of a set-created resource exist at resolve time, so no pre-existing panel can be moved onto it by an update. The excusal would be unreachable, and blocking is the safe direction.
3. Blocking = doomed − excused. When it is non-empty, return one blocker string for that edit.

The reverse walk keeps this sound. Panel edits for the set's own panels always undo before the resource delete, because a patch set must create the resource before it can bind a panel to it. Each excused id is one the walk removes before the delete.

### D3. Naming, readability and log disclosure
For each blocking panel, the check tries a sharing-aware read as the undoing user (`panelRepo.findById(panelId, Some(user))`, plus the dashboard name via `dashboardRepo.findById(dashboardId, Some(user))`).
- Readable panels are named as `"<title>" on dashboard "<name>"`.
- Unreadable panels are counted: `and N panel(s) on dashboards you cannot see`.
The blocker string follows the existing style: `edit <i> (<kind> create): <k> panel(s) were added after the patch set was applied and would be deleted: ...; remove or rebind them before undoing`.
No panel id, title or dashboard name of an unreadable panel ever appears in the message or in logs at INFO or above. Readable names are capped at a fixed number (10) with a "+N more" tail, so a large board cannot produce an unbounded 409 body. The readability lookups are capped the same way: at most 10 panels are looked up, and the rest are reported only in the "+N more" count. Alternatively, all of them are batched into one read.
The Phase-2 failure reason from D4 is logged at ERROR by `restoreAll`. It is a fixed phrase plus a count (`edit <i> (<kind> create): <n> panel(s) were bound during the undo; nothing further was undone`), with no title, dashboard name or id, so the log path cannot leak either. A test covers that string. (Skeptic design r1 CR3.)

### D4. The check-to-delete window
The Phase-1 check and the Phase-2 delete run in separate transactions.

**Output arm, closed by a row lock.** Inside `deleteWithPanelsInternal`'s existing transaction, the order is:
1. `PanelRowLocks.lockForDeletion`, then `locks.lockPipelines` (unchanged; this keeps HEL-1629's pipeline-first order against draft save);
2. `SELECT 1 FROM outputs WHERE id = O FOR UPDATE`. This conflicts with the FOR KEY SHARE lock that any panel insert or update referencing O takes through the FK. So it waits for an in-flight bind to commit or roll back, and blocks any later one until this transaction ends;
3. re-count the panels bound to O. In Phase 2 the expected count is zero: the reverse walk has already deleted the set's own panels and moved any rebound panels off O. A non-zero count aborts the transaction with a typed failure before the delete.
The undo then reports that edit as `failed` through the existing honest-partial-outcome tier, and the walk stops. The lock order (panels, then dashboards, then pipeline, then Output) matches V130. The executor SHALL verify there is no deadlock against draft save (pipeline row first) and against panel create (dashboard, then KEY SHARE on O). If the lock cannot be taken safely, this arm documents the same residual as the other three and does not claim closure. (Skeptic design r1 CR2.)

**`pipelineStep`, `pipeline` and `dashboard` arms, a documented residual.** These deletes run inside service methods that own their transactions (`deleteStep`, `PipelineService.delete`, `DashboardService.delete`). Phase 2 re-runs the D2 computation immediately before each delete and reports `failed` if it is non-empty. The window that remains runs from that re-check to the delete's cascade, and it includes a bind that is uncommitted and in flight during the delete. It is accepted as the same class as V130's RESIDUAL paragraph and HEL-1485's accepted "panel created after the pre-lock" residual. The code comment SHALL cite V130's RESIDUAL paragraph rather than restate it. Threading a guard action through three service-owned transactions is out of proportion for this bug. (Skeptic design r1 CR4, accepted with these conditions.)

### D5. Tests run on the app role
Specs wire the apply and undo services, panel create and duplicate, and grants on `helio_app_test` (NOBYPASSRLS), with the privileged pool for the internal reads exactly as production wires them, following `FormSubmitEditorRlsSpec` and the red spec.

## Risks / Trade-offs

- [An undo becomes impossible while foreign panels stay bound] → The message names what to remove. The owner chose this trade-off over deletion.
- [The excused-set logic wrongly excuses a panel] → The created-panel excusal gets a test, plus a mutation run (drop the excusal → the self-created-panel scenario must go red). Also a negative test: a later panel is never excused.
- [Disclosure of unreadable panels through the message] → Covered by a test with a panel on a dashboard the undoer cannot read, asserting the title and dashboard name are absent from the 409 body. Reaching it needs a real path: B creates an Output on A's pipeline (if an editor may) and binds it on B's own dashboard, and A undoes the pipeline create. If no real path reaches it, the test drives the helper directly and says so.
- [Residual race on the three service-owned deletes (D4)] → Documented, citing V130's RESIDUAL paragraph.
- [The dashboard arm may also raise the existing "dashboard ... was changed" layout blocker] → Tests assert that the panel-naming blocker is present, not that it is the only one.
- [Undoing a pipeline create still deletes Outputs other users added to that pipeline (only their panels are protected)] → Owner-scoped non-goal. The PR body states it plainly.

## Migration Plan

None. No schema change, so V147 is unused. Rollback is a code revert.

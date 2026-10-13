## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 968835477e67901a21c5d9fd8d22f7918a6558c3 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` READY, branch `bug/single-panel-row-lock-order/HEL-1498`.
- **Fold-in is real:** `.concertino/runs/HEL-1498/events.jsonl` lines 4-5: escalation `HEL-1498-1791863327533-e537a4`, `answer: fold-in`, `answer_source: human`. HEL-1526 text read from Linear. Its AC is "do not overwrite a layout it did not read ... a layout write that commits mid-request survives".
- **W1-W8 table, lines and pools: all confirmed against the tree.**
  - `DashboardContentsOps.replaceContents` uses `withSystemContext` with an unlocked `headOption` read.
  - `PanelMutationRepository.scala:88` (system).
  - `PanelRepository.scala:216` (system; selects ids, then deletes).
  - `PipelineRepository.scala:485` (`withUserContext`).
  - `PipelineStepRepository.scala:1000` (system; first write is the head-child update at :1020).
  - `PipelineRootWrites.scala:162` (`runTransactionally(user)`, i.e. user context).
  - `DataSourceRepository.scala:263` (user).
  - `WorkspaceTeardownRepository.scala:166` calls `lockPanelRows(dashboardIds)`, then deletes pipelines, sources and dashboards.
  - `DashboardRepository.scala:217` is `lockPanelRows`.
  - Dead deleters confirmed with no main callers: `PipelineStepRepository.delete:311`, `PipelineRootRepository.remove:147`, `OutputRepository.deleteByNodeInternal:309`. `PipelineStepRepositorySpec.scala:213` does call `stepRepo.delete`, so removing it also edits that test.
  - FK cascades confirmed: V94:209/344, V98:80-81/119/145. `pipeline_steps.parent_step_id` (V94:172) has **no** ON DELETE action.
- **The RLS-hidden-panels claim holds.** V36:146-162: `panels_select`/`panels_update` USING `helio_can_access_dashboard(dashboard_id)`, so a pipeline owner's `FOR UPDATE` cannot see a grantee's panels. RI cascades still delete them. The function-based design is justified for W4, W6, W7 and W8.
- **SECURITY DEFINER vs precedent:**
  - V40, V100 and V122 all use the transient `GRANT CREATE` / `ALTER FUNCTION ... OWNER TO helio_privileged` / `REVOKE CREATE` bracket. V100 and V122 add `SET row_security = off`.
  - V40's callable definer functions keep PUBLIC EXECUTE. D1's `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE` to the migrating role is stricter than precedent, and it is sound.
  - The app, privileged and Flyway pools all use the same login (`application.conf:93-106`, `SET ROLE helio_privileged`). The system pool executes as the owner, and the app pool needs the EXECUTE grant.
  - The planned grants (`SELECT, UPDATE ON panels` for `FOR UPDATE`; `SELECT` on outputs, pipeline_steps and pipeline_roots) are sufficient. The function reads no other table.
- **Migration numbers:**
  - On origin/main and in this worktree the latest migration is V127.
  - HEL-1434's worktree has `V128__stored_object_deletions.sql` committed locally (13f4e3d73), not on origin.
  - No `outOfOrder` is configured anywhere in `backend/src/main`, so Flyway defaults apply (outOfOrder=false, validateOnMigrate=true).
- **HEL-1526 premise:** the only caller of `replaceContents` is `DashboardContentsService.scala:98`, which passes `Some(layout)`. Tests call only the service. The `None` branch is dead, so making `layout` required is safe.
- **Preview design:**
  - `PatchSetPreviewService.previewResolved` projects each edit against the DB in isolation, which confirms item 3.
  - `before` = `ResolvedEdit.priorStateJson` (`PatchSetApplyTypes.scala:86`).
  - Apply's `staleTargets` recomputes the fingerprint on resolve-time state (`PatchSetApplyService.scala:~83-98`). Keeping `before` and fingerprints pre-apply is therefore correct, and an overlay fingerprint would 409 a two-edit set.
  - V127 is a BEFORE UPDATE bump trigger, so a re-read is needed for a current `layoutVersion`. That justifies D3's step 6.
  - `LayoutCasRetry.scala:32` is the apply-side `expectedLayoutVersion` rejection the overlay must mirror. Preview has no such check today.
  - The split is needed: `PatchSetPreviewProjection.scala` is 403 lines, and the unused `ExpressionEvaluator` import is at :7.
- **Ticket item 5:**
  - `DashboardDeleteRacesPanelDeleteSpec.scala:84-85`: `sqlState` maps any non-PSQL failure to `None`, and the assertions only check "not 40P01". The tightening is warranted.
  - The guard cases are confirmed at `PatchSetPreviewGhostLayoutSpec.scala:73,79`.
- **Can each red-first test go red on today's code?** I traced each one by hand against the current SQL. I did not run any tests (design gate).
  - **W1:** heap order B, A, then the gate deletes the dashboard and needs B. Red is possible.
  - **W2:** descending request order. Red is possible.
  - **W4 and W8 on a grantee dashboard:** red is possible, and only D1 turns them green. The design claims this, and I confirmed it via V36.
  - **W5:** red is possible.
  - **Preview "panel delete then rename":** red is possible, because the rename-only path leaves the layout unfiltered (guard :79).
  - **HEL-1526 spec: not as specified.** See CR1.

### Verdict: REFUTE

### Change Requests

1. **The HEL-1526 red-first spec (D6, task 5.3) can only go red on a dashboard with no panels, and the design does not say so.**
   - Today, when `replaceContents`'s `DELETE ... WHERE dashboard_id` removes at least one panel, V122's statement trigger (`V122:44-48`) locks the dashboard row `FOR UPDATE` at the end of that DELETE.
   - So a concurrent `insertPlaced` (which takes the dashboard `FOR UPDATE` first, `PanelLayoutPlacement.scala:47`) blocks until the replace commits. It then appends to the new layout and survives on the **pre-fix** code: no red.
   - The lost append happens only when the DELETE removes zero rows. The trigger fires but locks nothing, the gated INSERT lets `insertPlaced` commit, and replace's layout UPDATE then reverts its item.
   - Required:
     - D6 and task 5.3 must specify that the target dashboard starts with no panels.
     - The panel that `insertPlaced` creates must bind an output other than the gated one.
     - The gate must hold the output row `FOR UPDATE` (a `FOR NO KEY UPDATE` does not block the FK `KEY SHARE`).
     - D3 must record that this is the live exposure of HEL-1526 today, since the ticket's `None` write-back branch is dead.
2. **W3 misses a second transaction.**
   - `OutputService.delete` (`OutputService.scala:243-244`) runs `panelRepo.deleteByOutputIdInternal` and `outputRepo.deleteInternal` (`OutputRepository.scala:303`) as **two separate transactions**.
   - The second one cascades (V94:344) to every panel bound after the first one committed, with no id-ordered lock.
   - That is a transaction that can lock 2+ panel rows unordered, which AC1 ("every transaction") forbids. It is not in the W table or in task 3.3.
   - Required: make output delete one transaction with the lock first (lock(outputs=[o]), then delete panels, then delete the output), or put the lock inside `deleteInternal` too. Add it to the W table and task 3.3.
3. **The migration-number plan allows a silent prod failure.**
   - With V129 planned while V128 is not on origin/main, if this lane merges first, prod applies V129.
   - HEL-1434's V128 would then pass CI (a fresh DB migrates 128 then 129 in order) and fail in prod. With outOfOrder=false and validateOnMigrate=true, Flyway rejects "resolved migration not applied" and `Database.initApp` fails the boot.
   - "Whichever lane merges second renumbers" depends on the other lane knowing, and nothing enforces it.
   - Required: D1, the Risks section and task 2.1 must state that the delivered file is exactly (max version on origin/main) + 1 when this branch merges (V128 if HEL-1434 has not merged yet). Then a clash is a loud duplicate-version failure, never a gap. The C2 local-safety reasoning still holds, because only embedded Postgres is used.
4. **Fix two inaccurate or ambiguous statements an implementer will act on:**
   - (a) D4 cites `PatchSetApplyTypes.scala:332`, but the file is 143 lines. Cite `PatchSetApplyTypes.scala:86` (`priorStateJson`) instead.
   - (b) D1 says `hel1498_lock_panels` `RETURNS void`, but D2 has W3's `deleteByOutputIdInternal` "return the ids actually locked". Say how: for example, `DELETE ... RETURNING id` after the lock call. Today's select-then-delete can under-report a panel inserted between the two statements.

### Non-blocking notes

- D1's `GRANT EXECUTE` must target `CURRENT_USER` (or `SESSION_USER`), not a literal `helio`. `LayoutStripDbSupport` migrates as `helio_migration_test`.
- W7 race fixture:
  - The pipeline needs at least 2 roots, or V99/V100's zero-root trigger raises P0001 after the fix and the spec fails as non-`(None, None)` for an unrelated reason.
  - The steps under the deleted root must have no child steps, because `parent_step_id` (V94:172) has no ON DELETE action.
  - Alternatively, bind the panels to a root-level output (`outputs.root_id`).
- W4 and W7 lock calls run before the owner-filtered DELETE. Make sure the service-level ownership check runs first, so a caller cannot lock another user's panels by id.
- Two pending creates in one patch set will both carry the `(pending)` panel id in the overlay layout. Make sure a later strip by panel id does not conflate them.
- The ~250-line budget should also hold after the overlay lands, not only at task 1.1.

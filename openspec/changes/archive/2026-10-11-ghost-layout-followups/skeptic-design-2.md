## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD bcb0e891923094c1a1e85ecc053f30a73ee6d70f (= origin/main). The change dir is untracked planning only. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/ghost-layout-followups/HEL-1485`.

### What I verified (with evidence)

- **Round-1 CR1 (teardown placement) is resolved.**
  - `WorkspaceTeardownRepository.planAndExecute` (lines 150-160) runs `deletePipelines andThen deleteSources andThen deleteDashboards` inside `withUserContext(...)(... .transactionally)`.
  - D2(b) and task 1.2b now put the panel-row pre-lock FIRST, before `deletePipelines`. They also add a teardown interleave test.
  - The RLS claim holds: `panels_select` and `panels_update` both use `helio_can_access_dashboard(dashboard_id)` (V36:146-152). The tagged dashboards are filtered by `owner_id = caller`, so the owner's `FOR UPDATE` sees every panel.
- **Round-1 CR2 (panel-to-panel residual) is resolved.** D2 names the residual explicitly, scopes it out, and task 1.2c requires it in the code comment and in `probe-deadlock.md`.
- **The single-statement lock-order claim, checked independently.** I wanted to know whether a multi-output cascade fires V122 once per RI query. If it did, the cascade would hold D and then lock more panel rows, which is a dashboard-to-panel inversion that D2's framing would miss.
  - I probed this on a throwaway PG 18.4 cluster in the scratchpad: pipeline → 2 outputs → 2 panels, all `ON DELETE CASCADE`, with a statement-level `AFTER DELETE ... REFERENCING OLD TABLE` trigger, then deleted the pipeline.
  - The trigger logged ONE firing with `10,20`. The cascaded panel deletes share one transition table and one firing, after all the panel row locks are taken.
  - So within one top-level statement the order really is panel rows, then dashboards. D2's characterisation stands.
- **D1 parity**, checked against `DashboardWrites.applyUpdate` and `writeUpdate` (`DashboardWrites.scala:36-104`):
  - `onlyPanels` is applied to the stored layout and to the patch, and `LayoutPolicy` then runs under `Validate`.
  - Rename only: `updateName` re-reads the row, so the layout is unfiltered. D1 mirrors this explicitly and comments it.
  - Rename + appearance: `onlyPanels(renamed.layout)`.
  - Appearance only: `live.layout`, filtered.
  - Preview today, `PatchSetPreviewProjection.scala:212-233`, uses no filter. Its only call site (line 83) already wraps the call in `Future.successful`, so making it Future-returning is mechanical. The prior is resolved before preview, and `panelIdsInternal` (`DashboardRepository.scala:181-184`) is privileged and unpaged, as D1 requires.
  - Red tests (a), (b) and (c) are red on current code, because `LayoutPolicy` has no notion of panel existence.
- **D3:** `AutoLayoutService.scala:102` (the `kept` base) and line 109 (the `LayoutPolicy(existing.layout, patch)` base) are both named now. The two planned red tests correspond to real defects at those lines.
- **D4:** `PatchSetUndoConflictCheck.scala:127-133` round-trips through `DashboardResponse`. Domain to response to domain is lossless for `{panelId,x,y,w,h}`. A refactor guarded by the existing D7 specs is appropriate.
- **The D2 fix sites are complete for dashboard deletion.** The only dashboard deleters are:
  - `DashboardService.scala:143`, which calls `DashboardRepository.delete` (`withSystemContext`, already `.transactionally` per `DbContext.scala:63-64`).
  - The teardown `deleteDashboards`.
  - There is no account-deletion cascade: no `users → dashboards ON DELETE CASCADE`, and no `DELETE FROM users` in `main/`.
- **Test harness:** `LayoutStripDbSupport` starts `VerifiedEmbeddedPostgres.start`, creates the app role NOSUPERUSER NOBYPASSRLS, and asserts that posture (line 33-34). That meets the AC's role requirement.
- **AC coverage:**
  - AC1 is covered by D1 and task 3.1.
  - AC2 is covered by D2 and tasks 1.1-1.3 and 3.3, both branches.
  - AC3 is covered by D3 and tasks 2.2 and 3.2.
  - AC4 is covered by D4 and tasks 2.3 and 3.4.
  - AC5: the design says V124 only, no migration expected, and the highest migration on disk is V123.
- **Spec deltas:**
  - The `openspec/specs/{patch-set-preview,dashboard-auto-layout,dashboard-delete}` capabilities all exist.
  - The `dashboard-delete` delta is conditional, and task 1.3 removes it if the deadlock is not reproduced.
  - No API shape change, so no schema delta is needed.
- **Placeholders and contradictions:** no TODO or TBD markers. Proposal, design, tasks and specs agree.

### Verdict: CONFIRM

### Non-blocking notes
1. **Teardown has a residual outside D2's framing, so name it in `probe-deadlock.md`.**
   - `deletePipelines`' cascade also strips (and V122-locks) UNTAGGED dashboards that hold panels bound to the tagged pipelines' outputs. The pre-lock does not cover those dashboards.
   - If a LATER statement in the same transaction (for example a `deleteSources` cascade reaching outputs) then needs a panel row on such a dashboard, it is a D-then-panel order across statements. It would deadlock with a concurrent single-panel delete on that dashboard.
   - This is pre-existing and not the ticket's dashboard-delete race. It is worth one sentence alongside the CR2 residual.
2. **The privileged role in `LayoutStripDbSupport` is `NOLOGIN` (line 31).**
   - The dashboard-delete side of the repro can run as the app role acting for the owner. Row-lock behaviour is identical, and the V36 owner DELETE policy permits it. Alternatively it can `SET ROLE` to a BYPASSRLS non-superuser.
   - Whichever is chosen, state it in the spec comment. D2's "exactly as the production pools do" is otherwise loosely satisfiable.
3. **`tasks.md`'s Standing Constraints lists only C1.** The overnight constraints (`[hel1468-guard]`, V124-only, no inline FQNs) live in `ticket.md` and design Planner Notes. That is acceptable, but listing them there would make them executor-visible in one place.
4. **The AC says "exactly as apply does", but preview is per-edit against stored state.** The PR must state that residual (D1 already commits to this).

## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD ea04f2aa24db7fcdcac9e832f730eec234232fb9 (= origin/main; the change dir is untracked planning only).

### What I verified (with evidence)

1. **The inversion is real as described.**
   - Create: `PanelLayoutPlacement.insertAndAppend` (PanelLayoutPlacement.scala:47) takes the dashboard row `FOR UPDATE`, then runs the
     panel INSERT. The INSERT's FK check takes KEY SHARE on `outputs`. Order: D, then O. Every panel-inserting path goes through it:
     `insertPlaced`:27, duplicate:75, `insertBatchPlaced`:173. `DashboardContentsOps.replaceContents` follows panels, then D (:61-62).
   - W4 `PipelineRepository.delete`:494, W5 `PipelineStepRepository.deleteInternal`:1005, W6 `removeRootCascadeAction`:1192
     (the first action of `PipelineRootWrites.removeRoot`'s transaction, :212), W7 `DataSourceRepository.delete`:270, W8
     `WorkspaceTeardownRepository`:166 all call `lockForDeletion` first, then DELETE. The FK cascade reaches O, then panels, then
     V122's statement trigger locks D. Order: panels, O, D. This is inverted against create.
   - W3 `OutputRepository.deleteWithPanelsInternal` (:314-321) deletes the panels explicitly before the Output, so V122 locks D
     before O. It is not inverted, so GUARD is the right label. `OutputRepository.deleteInternal` (:305) has no caller in
     `src/main` (grep finds only doc-comment mentions in OutputService.scala:22 and PatchSetPreviewRemovals.scala:11).
   - **Empirical repro (my own throwaway PG 18.4 cluster in the scratchpad, NOT the shared dev DB).** Mini schema: dashboards,
     outputs, panels with FK ON DELETE CASCADE, plus a V122-shaped AFTER DELETE statement trigger that locks dashboards
     `ORDER BY id FOR UPDATE`. Interleave per D4: a gate takes `LOCK TABLE panels IN SHARE MODE`; the create takes D FOR UPDATE and
     then INSERTs; the delete runs the lock function and then `DELETE FROM outputs`. Two runs each:
     - pre-fix (panel lock only): `create: ERROR: deadlock detected` on both runs;
     - post-fix (array_agg over the FOR UPDATE subquery, then dashboards `ORDER BY id FOR UPDATE`): no error on both runs. The
       Output and both panels were gone (the cascade removed the newly committed panel too) and D still existed.
     The probe used sleeps for sequencing. The spec must use lock-wait observation as D4 says. The probe confirms the mechanism,
     not the Scala paths.

2. **One consistent order, and no new inversion found.**
   - After V130 the order is: panel rows by id, then dashboards by id, then Output/pipeline/step/root/source rows. Create (D, then O)
     and replaceContents (panels, D, O) already follow it. The dashboard delete (`DashboardRepository`:199) and replaceContents now
     lock D inside the function. That is the same panels-then-D order they already used, and V122 then re-locks a row the
     transaction already holds.
   - I looked for a new O-then-D writer. The only Scala writers of `dashboards` are DashboardRepository, PanelRepository,
     PanelLayoutPlacement, WorkspaceTeardownRepository and DashboardContentsOps. Raw SQL: grep finds no
     `UPDATE/INSERT INTO/DELETE FROM dashboards` in any other Scala source. DataSourceReferenceRepository:95 is a read.
   - Triggers: only on panels (V122), dashboards (V127, BEFORE UPDATE version bump), image_uploads/data_sources (V128, enqueue
     only), pipeline_roots (V99/V100 zero-root guard) and audit_events. None of them goes from outputs/pipelines/steps/roots/sources
     to dashboards.
   - Every other row lock (grep for `FOR UPDATE|FOR SHARE|FOR KEY SHARE|forUpdate|pg_advisory`) is in ConnectorRepository,
     DataSourceRepository.lockSource, PipelineStepRepository:135, PipelineRunRepository (pipeline FOR KEY SHARE plus an advisory
     lock), PipelineCycleGuard or ProductEventRepository. None of these then writes or locks a dashboard.
   - The only service-level multi-repo transactions are `PipelineRepository.runTransactionally` callers: PipelineCreateTransaction
     (new pipeline, steps and outputs, no dashboard) and root removal (W6). Patch-set apply has no `.transactionally` in
     `services/patchsets`. D3's expected "none" holds on my reading. The executor still owes the recorded enumeration.

3. **CREATE OR REPLACE ownership, and the lock-ordering shape.**
   - V129 re-owns `hel1498_lock_panels` to `helio_privileged`. V34:27 grants `helio_privileged TO current_user`. The test harness
     (ProductTelemetryDbHarness.scala:63) grants `helio_privileged TO helio_migration_test WITH ADMIN OPTION`.
   - Probe on PG 18.4: a test-harness-shaped role ran `CREATE OR REPLACE` successfully and the owner stayed `priv_a`. A prod-shaped
     role (non-superuser CREATEROLE creates the role, then `GRANT ... TO current_user`) also succeeded. Its `pg_auth_members` shows
     the auto-grant row with inherit f / set f, but the explicit self-grant row has inherit t / set t, and the owner stayed `priv_d`.
   - A NOINHERIT member fails loudly: `ERROR: must be owner of function f`. `SET LOCAL ROLE <owner>` works for a NOINHERIT member.
   - So the design's premise holds under default role attributes, and the failure mode is loud, not silent.
   - Lock-ordering shape: `EXPLAIN` of `SELECT array_agg(DISTINCT dashboard_id) FROM (SELECT ... ORDER BY p.id FOR UPDATE OF p) s`
     shows `Aggregate -> Sort(dashboard_id) -> Subquery Scan -> LockRows -> (pkey-ordered scan)`. The subquery is not pulled up and
     LockRows runs over the id-ordered input, so the lock order is preserved. The DISTINCT sort sits above LockRows.

4. **D4 interleave.**
   - The gate's SHARE mode conflicts with the create's INSERT (ROW EXCLUSIVE) and with the cascade's DELETE FROM panels. It does not
     conflict with the lock function's ROW SHARE (`SELECT ... FOR UPDATE`).
   - Pre-fix: the delete holds O when its panel cascade blocks on the gate (outputs row deleted first, then its RI AFTER trigger
     cascades).
   - Post-fix: the delete blocks on D's row inside the function and has not yet touched O. After the gate commits, the create takes
     KEY SHARE on O, commits, and the delete proceeds. The `FOR UPDATE` on D re-checks the row the create updated, and the cascade
     removes both panels.
   - My probe reproduced both outcomes, twice each. `awaitLockWaitOf` (LockRaceSupport:61) matches `wait_event_type = 'Lock'`, which
     covers both relation-lock and tuple/transactionid waits.
   - Precedent for a SHARE-mode gate run as the schema owner: ReplaceContentsLayoutRaceSpec:88.
   - W5/W6/W7/W8 go through the same lock-function-then-cascade shape, so they plausibly go red. The design correctly allows a GUARD
     label with a reason if any of them does not.

5. **V130 is still free.**
   - `git fetch` then `git ls-tree origin/main .../db/migration`: the max is V129__lock_panels_for_deletion.sql (origin/main =
     ea04f2aa2).
   - No open PR adds a migration: the open PRs are dependabot plus #266.
   - The sibling worktrees (HEL-1424, HEL-1455) have no V130.

6. **Artifact consistency.**
   - The proposal, design, tasks and spec delta agree. No TODO/TBD.
   - The ticket ACs are covered: red-first on VerifiedEmbeddedPostgres/NOBYPASSRLS through LockRaceSupport (tasks 1.2-1.3), one
     consistent order (D1), and a new migration numbered max+1 with no applied file edited (2.1).
   - `openspec/specs/panel-row-lock-order/spec.md` exists, so the ADDED delta targets a real capability.

### Verdict: CONFIRM

### Non-blocking notes
- **Ownership assumption depends on INHERIT.** `CREATE OR REPLACE` works only because the migrating role's membership has
  INHERIT. CI cannot see prod's `pg_auth_members`, and the V129 header says the opposite ("afterwards the migrating role no longer
  owns the function and could not change its ACL").
  - The V130 header should state the real mechanism (an inheriting member of the owner may replace) and say that V129's sentence
    is superseded.
  - Optionally make it robust: wrap the replace in `SET LOCAL ROLE helio_privileged` with V129's transient `GRANT CREATE ON SCHEMA
    public` bracket (the GRANT before the SET). This relies only on the SET capability, which the prod app pool already uses on
    every `withSystemContext` call. A NOINHERIT failure would be loud at deploy anyway, so it would not corrupt data.
  - The design's "fall back if replacing fails on the embedded DB" cannot detect a prod-only difference.
- **The D2 residual is acceptable as documented.** Closing it cheaply would mean also locking the Output rows inside the function.
  That would put O ahead of the pipeline row for W4, which would invert against PipelineRunRepository's pipeline `FOR KEY SHARE`
  followed by `outputs` writes. That is a new risk, so leaving D2 open is the right call. Keep the residual description precise:
  it needs a create to commit inside the window between the lock function and the DELETE statement, then a second create on the
  same dashboard.
- **Task 2.3 is optional cleanup.** Removing `OutputRepository.deleteInternal` is fine (it has no caller in main). If tests call it,
  prefer removing those test uses rather than keeping dead code just for coverage.
- **Re-grants.** The migration should not re-run `REVOKE ... FROM PUBLIC` / `GRANT EXECUTE` unless it has to. CREATE OR REPLACE
  keeps the ACL, and V129 notes that ACL changes from a non-owner are fragile. Re-stating `GRANT SELECT, UPDATE ON dashboards TO
  helio_privileged` is harmless because the migrating role owns that table.
- The red evidence should make clear which side received the 40P01. In my probe it was the create, but either side is valid.

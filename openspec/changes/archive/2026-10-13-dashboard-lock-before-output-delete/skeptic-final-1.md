## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: `0ec764c577b5a2c773a8f91e922ea5502e47a760`. Diff base resolved live via `resolve-review-base.sh`
(main/origin): `ea04f2aa24db7fcdcac9e832f730eec234232fb9`. Spawn-cwd guard:
`READY ambient=/home/matt/Development/helio branch=bug/panel-create-output-delete-deadlock/HEL-1534`.

### What I verified (with evidence)

- **Migration numbering.** After `git fetch origin main`, the max migration on origin/main is still
  `V129__lock_panels_for_deletion.sql`, so V130 is max+1. `git merge-base --is-ancestor origin/main HEAD` succeeded.
  The diff touches no applied migration; V129 is unedited.
- **AC1, red first (re-run by me, not taken from red-evidence.md).** I extracted `git archive 0ec764c57` into a scratch
  dir outside the repo, deleted only `V130__lock_dashboards_for_output_deletion.sql`, and ran
  `HELIO_TEST_JVM_XMX=3g HEL924_TEST_GROUP_CONCURRENCY=1 nice -n 19 sbt -J-Xmx3g 'testOnly *OutputDeleteRacesPanelCreateSpec'`.
  Result: exit 1, `Tests: succeeded 1, failed 5`. W3 GUARD `(None,None)`. W4 `(Some(40P01),None)`, W5 `(None,Some(40P01))`,
  W6 `(None,Some(40P01))`, W7 `(None,Some(40P01))`, W8 `(Some(40P01),None)`. W5's victim side differs from
  red-evidence.md (create there, delete here). The spec explicitly allows either side to be the victim, so this is not
  a discrepancy. The harness (`LayoutStripDbSupport.startPostgres`) migrates and runs as `helio_migration_test`
  (LOGIN NOSUPERUSER NOBYPASSRLS, with a `require` on that posture), on `VerifiedEmbeddedPostgres`. The racer's D is a
  grantee's dashboard. The interleave uses `awaitLockWaitOf` on named pools and has no sleeps.
- **AC2, green (re-run by me in WORKTREE_PATH).** I ran the same capped command over
  `*OutputDeleteRacesPanelCreateSpec *PanelWriterLockOrderRaceSpec *PipelineCascadeLockOrderRaceSpec
  *DashboardDeleteRacesPanelDeleteSpec *ReplaceContentsLayoutRaceSpec *ResourceTagMigrationSpec
  *PatchSetUndoPanelDashboardSpec`. Result: exit 0, `Suites: completed 7`, `Tests: succeeded 29, failed 0`, and all six
  new cases `states (create, delete) = (None,None)`. Flyway log timestamps (01:22) matched wall-clock `date` (01:22:28),
  so the run was fresh and not a cache replay.
- **Full backend gate.** I did not re-run it. I relied on the evaluator's pasted, unambiguous five-shard output: per-shard
  counts sum to 7729 tests and 581 suites, with 0 failed and 0 aborted, matching green-evidence.md's totals.
- **Fix design, read in full (V130).** The panel-lock statement is V129's predicate, now wrapped as a subquery with
  `ORDER BY p.id FOR UPDATE OF p`. The LockRows node sits above the Sort, so panel lock order is unchanged. Then one
  `FOR UPDATE OF d` statement, ordered by `d.id`, locks the union of the locked panels' dashboards and `p_dashboard_ids`.
  The signature, SECURITY DEFINER, `search_path` and `row_security = off` are unchanged.
  - Ownership via `SET LOCAL ROLE helio_privileged` holds under the non-superuser harness.
  - If the replace had re-owned the function to the NOBYPASSRLS migrating role, `row_security = off` would fail the
    grantee-dashboard race. It is green.
- **Lock-order audit (independent).** `lockForDeletion` callers: `DashboardContentsOps:61`, `DashboardRepository:199`,
  `OutputRepository:309`, `PipelineRepository:494`, `PipelineStepRepository:1005` and `:1192`,
  `DataSourceRepository:270`, `WorkspaceTeardownRepository:166`.
  - All of these are delete or replace paths. Each now takes panels, then D, then everything else.
  - Before V130 the same D set was already locked later by V122's trigger, so V130 moves the dashboard lock earlier; it
    does not widen which dashboards get locked.
  - `PipelineStepRepository.deleteInternal` only reads before the lock call.
  - `PanelMutationRepository`'s batch update locks panel rows only and makes no lockForDeletion call, so it gains no D
    lock.
  - The create path (`PanelLayoutPlacement:47`: D `FOR UPDATE`, then the INSERT's KEY SHARE on O) is now consistent
    with every delete path.
  - I found no writer that holds D and then waits on a panel row or on O ahead of a delete's lock call.
- **Dead-code removal.** No main-source caller of `OutputRepository.deleteInternal` remains (grep: the only
  `deleteInternal` hits are `PipelineStepRepository`, `DashboardService` and comments). The four test call sites moved to
  `deleteWithPanelsInternal`.
- **UI.** No `frontend/**` changes, so step 4 does not apply and no servers were started.

### Verdict: CONFIRM

### Non-blocking notes
- The documented residual is real: a dashboard that gets its first O-bound panel between the lock call and the
  cascading DELETE is still locked late by V122. It is the same class HEL-1485 accepted. Consider a Follow-up ticket
  (relatedTo HEL-1534) so the residual is tracked outside a SQL comment.
- `PatchSetUndoPanelDashboardSpec.scala:187` weakened its precondition from "Output deleted" to "no panels removed". It is
  still caught indirectly by the undo assertions; an explicit "Output gone" check would localize a failure (agrees with
  the evaluator).
- Line widths over ~120 columns in `PanelRowLocks.scala:28` and the new spec are cosmetic.

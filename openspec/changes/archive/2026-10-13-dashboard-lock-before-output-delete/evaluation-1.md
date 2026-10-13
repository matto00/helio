## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed head: `0ec764c577b5a2c773a8f91e922ea5502e47a760`. Diff base (resolved live from origin/main): `ea04f2aa24db7fcdcac9e832f730eec234232fb9`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/panel-create-output-delete-deadlock/HEL-1534`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (red first, 40P01 on `VerifiedEmbeddedPostgres` as a NOBYPASSRLS role, `LockRaceSupport` pattern): met. I re-ran the
  red myself rather than trusting `red-evidence.md`. I used a throwaway worktree detached at `0ec764c57` with
  `V130__lock_dashboards_for_output_deletion.sql` deleted, so the delivery worktree was never touched. The scratch
  worktree was then removed (`git worktree remove --force`) and the delivery worktree is clean. Command:
  `HELIO_TEST_JVM_XMX=3g HEL924_TEST_GROUP_CONCURRENCY=1 nice -n 19 sbt -J-Xmx3g 'testOnly *OutputDeleteRacesPanelCreateSpec'`,
  exit 1, `Tests: succeeded 1, failed 5`:
  - W3 GUARD `(None,None)`
  - W4 `(Some(40P01),None)`
  - W5 `(Some(40P01),None)`
  - W6 `(None,Some(40P01))`
  - W7 `(None,Some(40P01))`
  - W8 `(Some(40P01),None)`

  This matches `red-evidence.md` exactly, victim side included. W4 to W8 are real PROOFs; W3 is correctly labelled
  GUARD. The migrating role is `helio_migration_test` (LOGIN NOSUPERUSER NOBYPASSRLS, owner of the public schema;
  `LayoutStripDbSupport.startPostgres` checks this posture with a `require`). The dashboard D belongs to the grantee,
  so the pipeline owner cannot see it under RLS.
- AC2 (one consistent order, new migration = max on origin/main + 1, no edits to applied migrations): met. I fetched
  origin/main again just before writing this report and V129 is still the max, so V130 is max+1. No other live
  worktree under `.claude/worktrees/` contains a `V130*` file. V129 is not edited.
- Tasks 1.1–3.2 are all checked, and each one matches what the diff does. The spec delta (`panel-row-lock-order`, ADDED
  requirement) describes the implemented behaviour.
- Scope: the only change outside the race and the migration is removing the dead `OutputRepository.deleteInternal`.
  design.md D1/tasks 2.3 told the executor to do this. A grep confirms no main-source caller remains (the only
  `deleteInternal` hits left are `PipelineStepRepository`'s).
- D3 enumeration, which I checked independently:
  - No service file composes a DBIO that touches dashboards. Every transaction that touches dashboards lives in a
    persistence repository.
  - Every repository that writes dashboards either takes D first (`PanelLayoutPlacement.insertAndAppend`
    `forUpdate`, then the panel INSERT and its KEY SHARE on O) or calls `lockForDeletion` first. Those callers are
    `DashboardRepository.delete:199`, `DashboardContentsOps:61` and `WorkspaceTeardownRepository:166`, and the call
    now locks D inside the function.
  - Every Output-removing writer calls `lockForDeletion` as its first write: `OutputRepository:309`,
    `PipelineRepository:494`, `PipelineStepRepository:1005` (only reads before it) and `:1192`,
    `DataSourceRepository:270`.
  - Triggers on outputs, pipelines, pipeline_steps, pipeline_roots and data_sources: only V99 (pipeline_roots guard)
    and V128 (enqueues data_sources objects). Neither reaches dashboards.
  - Create paths that build a new Output and a new dashboard (import, first-run, templates) only lock rows they have
    just inserted, so they cannot be part of a deadlock cycle.
  - I agree with the executor: no writer locks O and then D.
- No CONSTRAINTS in `workflow-state.md` (`CONSTRAINTS: []`).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself in WORKTREE_PATH. This is backend-only, so the frontend gates do not apply.
- Targeted run:
  - Specs: `OutputDeleteRacesPanelCreateSpec`, `PanelWriterLockOrderRaceSpec`, `PipelineCascadeLockOrderRaceSpec`,
    `DashboardDeleteRacesPanelDeleteSpec`, `ReplaceContentsLayoutRaceSpec`, `ResourceTagMigrationSpec`, and the four
    moved call-site specs.
  - Result: exit 0, `Suites: completed 10`, `Tests: succeeded 51, failed 0`.
  - All six new cases show `states (create, delete) = (None,None)`.
- `sbt testFull`:
  - An unsharded run does not fit the 10-minute foreground cap: I tried it under `timeout 590` and it was killed with
    exit 124. I then ran the same command as five sequential shards using the repo's own HEL-1287 mechanism
    (`HELIO_TEST_SHARD_INDEX=0..4 HELIO_TEST_SHARD_COUNT=5`, which checks the partition is exact), each with the
    capped settings.
  - Every shard exited 0 with `[hel1468-guard] failed=0 aborted=0`.
  - Tests: 1475 + 1549 + 1633 + 1628 + 1444 = 7729 succeeded, 0 failed.
  - Suites: 115 + 116 + 116 + 117 + 117 = 581 completed, 0 aborted.
  - Both totals match the executor's green-evidence numbers.
- Also run, all exit 0: `npm run check:repo-integrity`, `check:scala-quality` (enforces the CONTRIBUTING
  imports/qualifiers [mechanical] rule), `check:openspec`, `check:spec-structure`, `check:no-credential-leak`,
  `check:test-temp-dir-hygiene`, `format:check`.

Code review:
- V130 keeps V129's panel-lock statement as it was. The panel-lock SELECT is now a subquery that `array_agg` reads
  from, and the inner `ORDER BY p.id FOR UPDATE OF p` still sets the lock order. The HEL-1498 ordering specs stay
  green. Then V130 locks `dashboards` in one id-ordered `FOR UPDATE OF d`. Signature, `SECURITY DEFINER`,
  `search_path` and `row_security = off` are unchanged.
- Ownership:
  - V130 uses `SET LOCAL ROLE helio_privileged`, not V129's re-own bracket. This is a new mechanism, but it is safe:
    - It is exercised by a NOSUPERUSER NOBYPASSRLS migrating role that is a member of `helio_privileged`, the
      same shape as production.
    - `row_security = off` acts as a tripwire. If V130 had silently re-owned the function to the migrating role, the
      grantee-dashboard race spec would fail with 42501. It is green.
  - Production's DB_USER already does `SET ROLE helio_privileged` on every privileged-pool connection, so the SET
    capability the migration relies on is already exercised in production.
  - The header records why V129's "could not change its ACL" sentence no longer applies.
- The new spec drives the interleave from observed lock waits only (`awaitLockWaitOf` on named pools). There are no
  sleeps. `sqlState` is strict, and the post-condition asserts (D still exists, O deleted, 0 panels bound) run only
  when neither side was the deadlock victim. That condition is correct: a victim legitimately rolls back.
- The four call sites moved off `deleteInternal` onto `deleteWithPanelsInternal`:
  - `OutputHistoryPublicRoutesSpec:153`, `PublicProvenanceRoutesSpec:229`, `AlertRuleRepositorySpec:261`: the end
    state is the same. Before, the FK `ON DELETE CASCADE` removed the bound panels and alert rules. Now the panels
    are deleted explicitly, then the Output, and the cascade still removes the rules. Each test's assertions (404 on
    history and provenance, rule gone) still test what they meant to.
  - `PatchSetUndoPanelDashboardSpec:187`: changed from `shouldBe true` (Output row deleted) to `shouldBe empty` (no
    panels removed). `empty` is correct for the new return type, because the earlier patch-set edit already deleted
    the panel. But the line no longer asserts that the Output is gone. The test still catches a delete that silently
    did nothing: if the Output survived, the undo's `PanelService` outputId check would pass, the panel would be
    recreated, and both `statuses should not contain "recreated"` and `findByIdInternal(panel.id) shouldBe None`
    would fail. So the test is still meaningful. The weaker precondition is listed as a non-blocking suggestion
    below.

### Phase 3: UI Review — N/A
None of the Phase 3 trigger paths are touched: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.
The spec delta lives under `openspec/changes/`. No dev servers were started.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoPanelDashboardSpec.scala:187`: put back an explicit
  check that the Output is gone, which `shouldBe true` used to give. For example, follow the call with an assertion
  that the Output no longer resolves (`outputRepo.findById...` / a superuser `exists` check). The precondition would
  then fail at the line that broke, not show up indirectly in the undo assertions.
- `PanelRowLocks.scala:28` (152 chars, the edited scaladoc line) and a few lines in
  `OutputDeleteRacesPanelCreateSpec.scala` (41, 52, 53, 68, 77) are over the ~120-column width used elsewhere. No
  checker enforces it; this is cosmetic.

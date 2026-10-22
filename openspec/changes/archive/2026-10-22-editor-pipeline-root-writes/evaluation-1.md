## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `ba48a3f040bfe81a743e49d81438f7c1c871e46a` (HEAD of `bug/editor-pipeline-root-writes/HEL-1652`).
Diff base was resolved live with `resolve-review-base.sh` to `14c08def8a69f78fe1f81fcb86a7a3d928d06ab3` (origin/main).

### Phase 1: Spec Review — PASS

- AC "red-first tests on TwoUserRlsApiFixture (NOBYPASSRLS) for editor add and remove": done. `DraftSaveRlsSpec` (a
  `DraftSaveApiFixture`, so it runs on the NOBYPASSRLS app role) adds an editor-add test (201, root read back) and an
  editor-remove test (200; root, step t4 and its snapshot gone). The red-first claim holds without relying on the
  executor's log. The replaced C5 tests pinned exactly the old behaviour, 500 on editor add and a 200 that changed
  nothing on editor remove, so the new assertions (201, and the rows gone) were necessarily red on unchanged code.
- The mutation claims hold by reasoning on the code. Reverting `add` to `withUserContext` brings back the owner-only
  `pipeline_roots_insert` WITH CHECK failure, so the 500 returns and the editor-add test goes red. Pointing `removeRoot`
  at the user-context runner makes the editor's delete match 0 rows. That now raises `RootAlreadyRemoved` (404), not
  200, and the editor-remove test goes red. I did not re-run either mutation myself.
- AC "viewer and stranger still refused": covered for both verbs, with stored state unchanged (`DraftSaveRlsSpec`, "refuse a viewer (403) and a stranger (404) on root add and remove").
- AC (e) "HEL-1631 draft flow works for an editor": already covered on NOBYPASSRLS by `DraftSaveRlsSpec:15-25` (editor
  read, then save, then 200). Confirmed by reading the file and by this run's green result.
- AC "never a 500, never a false 200": the happy, refusal and cycle paths are covered. The race path (0 rows deleted)
  is implemented as a 404, but the HTTP/service mapping has no test. See Phase 2, CR 1.
- Design D1 to D7: implemented as written. D2: `add` runs on `withSystemContext`, and `removeAction` is now scoped by
  `pipelineId`. D4: there is one shared `PipelineRootRepository.removeRoot`, and all four race/deadlock specs call it.
  `DraftSaveRaceSpec` gains an editor root-add case. D5: zero deleted rows aborts with `RootAlreadyRemoved`.
  D6: `PipelineRootWriteGrantsSpec`. D7: tests listed above, plus the cycle-closing editor add returning 400.
- The D2 audit holds on my own read of every statement. In the add chain: the source `FOR KEY SHARE` uses an explicit
  id; the pipeline name uses an explicit id; the cycle guard's `findReadEdgesVisibleTo`/`findUpsertWriteEdges` filter
  explicitly by owner or grantee; max position and the insert are filtered by `pipelineId`. In the remove chain: the
  panel/pipeline locks use explicit ids; the step read and both `node_snapshots` deletes are filtered by `pipelineId`;
  the step delete uses ids derived from that pipeline's rows; the root delete uses `id` + `pipelineId`; `compactPositions`
  is filtered by `pipelineId`. No statement depended on RLS for its scoping.
- Tasks 1.1 to 3.4 are checked and match the diff. Task 4.1 (the PR body) is the orchestrator's at Delivery and is not
  counted here.
- No scope creep. No API or schema change, as the proposal states. `openspec validate --strict` reports the change as
  valid, and `check-openspec-hygiene.mjs` is clean.
- CONSTRAINTS: `[]`, nothing to honour.

### Phase 2: Code Review — FAIL

Gates, run by me in this worktree:
- `cd backend && sbt testFull` (`HELIO_TEST_JVM_XMX=3g`, `nice -n 19`): **exit 0**, with "Tests: succeeded 9432,
  failed 0, canceled 5". The 5 canceled tests are the pre-existing measure/heap tests that are opt-in by env var.
  `DraftSaveRlsSpec` (9 tests, including the 5 new root tests), `PipelineRootRemoveAtomicitySpec`,
  `PipelineRootWriteGrantsSpec` (3), `DraftSaveRaceSpec` (including "root add by an editor grantee", with its control
  red without `root.add`), `DraftSaveDeadlockSpec`, `PipelineCascadeLockOrderRaceSpec` and
  `OutputDeleteRacesPanelCreateSpec` all ran and passed.
- `node scripts/check-scala-quality.mjs`: clean (soft warnings only, all pre-existing).
- No `frontend/**` changes, so the frontend gates do not apply.

D6 check: `ProductTelemetryDbHarness` migrates as a NOSUPERUSER, NOBYPASSRLS table owner. `helio_privileged` gets no
hand-written table grants (`GRANT helio_privileged TO helio_migration_test` makes the migration role a member of
`helio_privileged`, not the other way round). So the `has_table_privilege('helio_privileged', ...)` results do come
from the migrations, through V38's blanket grant plus `ALTER DEFAULT PRIVILEGES`. The evidence is valid.

Issues:
1. **Untested new code path that guarantees an AC: `RootAlreadyRemoved` is mapped to 404**
   (`backend/src/main/scala/com/helio/services/pipelines/PipelineRootWrites.scala:216`). If that `case` line is
   deleted, the exception falls through to `PipelineService.classifyDbError`'s `case other`
   (`PipelineService.scala:350-352`), which returns `InternalError`, a 500. No test in the suite would go red. That is
   exactly the AC's "never a 500" in the race case. Design D5 also says the test asserts "404". The new
   `PipelineRootRemoveAtomicitySpec` asserts only the repository-level exception and the rollback. The executor noted
   this gap; I judge it blocking, because this mapping is the only thing behind the AC in that path.
2. **Dead parameter**: `PipelineRootRepository.removeRoot`'s `run: DBIO[Set[String]] => Future[Set[String]] = ctx.withSystemContext(_)`
   (`PipelineRootRepository.scala:175`) has no caller that passes it: no production caller and no test. It is a
   test-only seam that no test uses. That is dead code and an unneeded abstraction.
3. **Stale comments** (task 2.6 required updating these):
   - `PipelineRootRepository.scala:86-87` still says the lock and cycle check run "INSIDE this method's own existing
     `ctx.withUserContext` flatMap chain". The chain is now `ctx.withSystemContext`.
   - `PipelineRootRepository.scala:154-155` (`removeAction` scaladoc) still says it is composed into
     "`PipelineService.removeRoot`'s ONE transaction". It is now composed in this repository's own `removeRoot`.

Checklist: security/scoping OK (D2 audit above). Error handling OK apart from issue 1. Type safety OK. DRY improved
(four hand-built transactions replaced by one shared method). No unused imports. File sizes are within the quality
check.

### Phase 3: UI Review — N/A

None of the trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The
backend-only diff changes no API shape. The editor draft flow (AC e) is covered on NOBYPASSRLS by
`DraftSaveRlsSpec:15-25`. A UI run on the local superuser database would prove nothing about RLS.

### Overall: FAIL

### Change Requests
1. Add a test that drives the `RootAlreadyRemoved` to 404 mapping through `PipelineRootWrites.removeRoot` (or the
   `DELETE /api/pipelines/:id/roots/:rootId` route) and asserts `404 Root not found` rather than 500. Suggested shape:
   wire a `PipelineRootRepository` subclass whose `removeRoot` override calls `super.removeRoot(..., afterCascade = sqlu"DELETE FROM pipeline_roots WHERE id=...")`.
   That reproduces the real race end to end. Also assert the steps and snapshots are restored. Record that deleting
   the `case PipelineRootRepository.RootAlreadyRemoved(id)` line at `PipelineRootWrites.scala:216` turns the test red
   (it then gets 500).
2. Remove the unused `run` parameter from `PipelineRootRepository.removeRoot` (`PipelineRootRepository.scala:175`) and
   call `ctx.withSystemContext(...)` directly. The alternative is to have a committed test that actually uses it.
3. Fix the two stale comments: `PipelineRootRepository.scala:86-87` (`withUserContext`, should be `withSystemContext`)
   and `PipelineRootRepository.scala:154-155` (`PipelineService.removeRoot`'s transaction, should be this repository's
   `removeRoot`).

### Non-blocking Suggestions
- `PipelineRootWriteGrantsSpec` could also assert `UPDATE` on `panels` (the `PanelRowLocks` `FOR UPDATE` in the remove
  cascade) and `EXECUTE` on `hel1629_lock_pipelines`. Both already run on the privileged pool in existing step-delete
  and draft-save paths, so this is defence in depth only.

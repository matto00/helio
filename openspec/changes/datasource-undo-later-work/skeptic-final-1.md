## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: d60f60a7ae328d11c200b0e38535767ec2b9bbdf. The diff base was resolved live with
`resolve-review-base.sh` and gave ebfeb6af76fdb594e072e46458d660c423a1db63, which is the merge-base with origin/main.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/datasource-undo-later-work/HEL-1796`.
- **No collision with HEL-1799 or HEL-1800.** origin/main has two commits since the base: 626cf9852 (HEL-1799) and
  9c2b5ba8e (HEL-1800). I intersected `git diff --name-only ebfeb6af7 origin/main` with the branch's own file list and
  found zero shared files. `git merge-tree --write-tree origin/main HEAD` merges cleanly. The branch makes no change
  to `DataSourceService`, to the row-write or form-submit routes, or to helio-mcp.
- **Red first, on helio_app_test.** I read `evidence/red-run-1.log` from the red commit 4ade5d2ad, where the spec
  file was the only change.
  - The `rolbypassrls` test passes, so the role does not bypass RLS. The spec asserts `rolbypassrls = false` at
    spec:163.
  - 9 tests failed, one for each kind of later work:
    - form submit, owner append, apply-era row edit, schema edit, replace, and delete-last-then-append: each returned
      `Right(... restored ...)`, which means the rows cascaded away.
    - a later pipeline root and a later form panel: each produced a partial undo. The edit statuses were
      `[failed, restored]`, so the set's dashboard was deleted while the source survived. The ERROR log printed the
      pipeline, panel and dashboard ids.
    - the Phase-2 re-check also failed.
  - The tests added after the red commit cover new structures (the journal round-trip, the legacy fallback and the
    backstop mapping), and most of them could not have compiled earlier. See the non-blocking note.
- **Green, re-run by me.** I ran
  `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.services.patchsets.* com.helio.api.routes.patchsets.*"`.
  It exited 0 with `Tests: succeeded 566, failed 0` and `hel1468-guard failed=0 aborted=0`. All 19
  PatchSetUndoDatasetLaterWorkSpec tests are listed as passing.
- **The fix refuses with a 409 and changes nothing.** Every refusal test asserts `ServiceError.Conflict`, and the
  routes map that to 409. Each test also checks that the source, the row count and the set's dashboard are unchanged:
  - spec:189-200 (form submit, still 4 rows);
  - spec:260-272 (pipeline: the dashboard survives, and no pipeline, source or dashboard id is in the message);
  - spec:274-294 (form panel: no panel, source or dashboard id).
  The hidden-pipeline test (spec:361-376) checks that the message says `1 pipeline(s) you cannot see` and does not
  contain the other user's pipeline name.
- **Mutations.** I read the evaluator's pasted mutation results in `mutations-{a,b,c}.txt`. Each comparison flip, the
  `describe` wording, removing the schema compare, removing the references call, moving the wiring into `guarded`,
  removing the Phase-2 re-check and reverting the backstop mapping turned at least one targeted test red.
  `evaluation-2.md` reports re-running m7 independently.
- **Each AC traced to code:**
  - Premise check: `evidence/premise-validation.md` records the V106 cascade, Phase-2-only reference guard and
    partial undo, and the red log confirms it.
  - Failing test first, on helio_app_test: done, as above.
  - 409, all-or-nothing: the Phase-1 check is wired at `PatchSetUndoConflictCheck.checkOne` in the
    `("dataSource","create")` arm. That arm runs the existing name check and then
    `PatchSetUndoDatasetLaterWork.blockers`. Phase 1 refuses before any restore.
  - Naming rule: `referenceParts` uses `PatchSetUndoBoundPanels.nameList` with names only, and the rest are counted.
    Row and schema messages give counts only.
- **Owner rulings followed:**
  - appends refuse (`created_at > T`);
  - apply-era edits refuse (`created_at <= T AND updated_at > T`);
  - schema edits refuse (parsed JSON compared with the journaled schema);
  - a lone delete with a journaled apply succeeds (spec:249-256);
  - D9 (inline dataset roots) is untouched, and task 5.1 is correctly left to the orchestrator at Delivery.
- **The `PatchSetUndoService` change is minimal.** One arm at line 126 is wrapped in `ifNoLaterDatasetWork`. A
  10-line helper re-runs the shared predicate and maps a backstop `DataSourceDeleteError` carrying a conflict to the
  fixed no-id phrase. Nothing else in the file changed.
- **REST, MCP and web wording.**
  - No route, helio-mcp or frontend file is in the diff.
  - I re-ran the frontend patchSets tests (`npx jest --maxWorkers=3 src/features/patchSets`): 8 suites and 80 tests
    passed.
  - I re-ran the MCP refinement tests (`npx jest --maxWorkers=3 helio-mcp/src/tools/refinement`, from the root): 3
    suites and 17 tests passed.
  - helio-mcp `refinement.ts:131` still says "the whole undo is refused".
- **Journal compatibility.** `createdDataset` defaults to `None`. Its format is declared before `journaledEditFormat`
  (jsonFormat10). An old-shape row parses to `None` (spec:348). The legacy fallback is tested by stripping the field
  from a stored row (spec:298-336).
- **UI review:** not applicable, because the change is backend only.

### Verdict: CONFIRM

### Non-blocking notes

- PatchSetUndoService.scala:126 is about 290 characters long. Moving the `DataSourceDeleteError` mapping into a named
  helper would make it readable.
- In `PatchSetApplyService`, `createdDatasets` is a mutable `ConcurrentHashMap` side channel, while the loop threads
  its other maps immutably. It works, but it is inconsistent.
- The reference tests cover roots, form panels and hidden pipelines, but not a join, union or lookup secondary, even
  though the spec scenario names those. This is covered indirectly, because `findReferences`
  (DataSourceReferenceRepository) already scans `join`/`lookup`/`union`/`upsertsource` step configs.
- On C12: the empty-source append test and the hidden-pipeline test were added after the red commit, although both
  could have been written red first.

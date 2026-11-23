## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `be1bad125094a63fc738b43bc69f8bb0c7aded32`. Base resolved live: `3dca8306ab72903544872ab9ddcf6b11f8d175a5` (origin/main).
Evaluator scratch output: `/home/matt/Development/helio/.concertino/scratch/HEL-1626/eval-*.txt`.

### Phase 1: Spec Review — PASS (one evidence-record defect, see Phase 2 / CR 1)

- Every AC is addressed. The D3 inventory holds up. I grepped `backend/src/main` for every `pipeline_runs` /
  `pipeline_run_assertions` / `runsTable` / `assertionsTable` / `started_at` / `startedAt` sort site and every caller of
  the run and assertion reads. Every ordering site is in `PipelineRunRepository` or `HomeSummaryRepository.load`, and
  every one is changed. Panel-status (`DashboardPanelStatusService` -> `AssertionStatusRule.latestRealRunAssertions` ->
  `latestNonDryRunInternal`), provenance (`ProvenanceService:69,172`), run-history (`PipelineRunQueries:101-103`),
  runs/latest (`PipelineRunQueries:44`) and context-details (`PipelineRunQueries:130-131`) all go through the changed
  reads. `PipelineContextAnalyzeReads` reads no runs, so D4 is right to leave it alone. `HomeSummaryBuilder`'s in-memory
  `sortBy`/`maxBy` are stable and take the first max, so they inherit the SQL order. I found no other run-order site.
- Direction stated (D1: `id DESC` is deterministic, not "more recent"). Comments say so at the contract site and in the
  reaper doc.
- Scope is clean: there are no changes to helio-mcp, the frontend or schemas, so the MCP goldens are untouched, and there
  is no migration. The EXPLAIN shows an incremental sort over the V136 index (0.071 ms), so no index is needed.
- Constraint C1 is honored. At the red commits `21e4601ec` and `fe52c1386`, `backend/src/main` is byte-identical to base
  (the diff is empty). The spec has not changed between `fe52c1386` and HEAD.

### Phase 2: Code Review — FAIL

Gates. I ran these myself in WORKTREE_PATH, with `nice -n 19` and `-J-Xmx3g`:
- Shard 1: the new spec, `PipelineRunRepositorySpec`, Live/Orphaned/Concurrency reaper specs, `PipelineRunHistorySchemaSpec`,
  `PipelineContextDetailsRoutesSpec` and `PipelineRunRoutesSpec`. 8 suites, 148 passed, 0 failed.
- Shard 2: the Home summary builder/routes/scoping specs, `DashboardPanelStatusRoutesSpec`, the Provenance
  routes/service/public specs, `OutputRoutesSpec`, `PipelineRunServiceSpec`, terminal-ordering, editor-persistence,
  late-finisher, output-history, alert-baseline and `PipelineAclSpec`. 15 suites, 335 passed, 0 failed.
- Shard 3: 29 further specs touching run/assertion reads (auto-run, guard, RLS, hooks, proposal parity, upsert-source,
  context-analyze). 29 suites, 253 passed, 0 failed.
- `check:scala-quality`, `check:openspec`, `check:spec-structure`, `check:test-temp-dir-hygiene`, `check:no-credential-leak`
  and `format:check` are all clean.

Red-first, reproduced independently. I checked out the base versions of the two main files in the worktree, ran the full
`PipelineRunOrderTiebreakSpec`, then restored. 15 of 26 tests failed, the same set as `red-run-2.txt`. Every changed read
has at least one red test, and the passing insertion order acts as the control. Each red comes from a forced tie: fixed
`started_at` / `created_at`, hand-picked ids, both insertion orders. None relies on luck from clock or random ids.

RLS. `TwoUserRlsApiFixture`'s `ctx` app pool is `SET ROLE helio_app_test` (`NOBYPASSRLS`). The spec's own probe asserts
`(rolbypassrls, rolsuper) = (false, false)` under `ctx.withUserContext`. `listByPipeline`, `listAssertionsByRun` and
`HomeSummaryRepository.load` run on that context and return non-empty rows, so RLS admitted the owner, and the reads are
red without the fix.

Own mutations. Each one dropped the tie-break back to `.sortBy(_.startedAt.desc)` on a single line, then I restored the file:
- `PipelineRunRepository.scala:573` (`listByPipelineInternal`) gave 2 red: the listByPipelineInternal test and the route test.
- `:589` (`latestRunInternal`) gave 2 red: the latestRunInternal test and the route test.
- `:701` (`latestRunIdsInternalBatch`) gave 3 red: both batch tests and the route test.

Issues:
1. **`mutations.txt` misrecords M05–M08.** The recorded red test names and failure counts do not match the read each
   entry names:
   - M05 "listByPipelineInternal" records 1 red in the *listByPipeline (RLS pool)* test. Really mutating that read gives
     2 red: the listByPipelineInternal test and the route test.
   - M06 "latestRunInternal" records the *listByPipelineInternal* test.
   - M07 "latestNonDryRunInternal" records the *latestRunInternal* test and the route test.
   - M08 "latestRunIdsInternalBatch" records 1 red in the *latestNonDryRunInternal* test. A real mutation of `:701`
     gives 3 red, both batch tests among them.

   The mutation sites were shifted by one, so the recorded evidence never mutated `latestRunIdsInternalBatch`, the read
   behind context-details (HEL-1619). The committed evidence file therefore claims a guard it did not demonstrate, and
   tasks.md 2.6 ("confirm the matching test goes red; record results") rests on it. My own mutations above show the
   tests do catch the regression, so the code and tests are sound. The committed record is not.
2. Non-blocking: `PipelineRunOrderTiebreakSpec.scala:111-114`. The newestN retention test inserts at `old` and then
   immediately UPDATEs `started_at` to a second `now()-3d`, which is redundant. The comment is also duplicated on lines
   112 and 113.
3. Non-blocking: `PipelineRunRepository.scala:37` adds a stray blank line between `assertionsTable` and `permTable`
   (drive-by whitespace).
4. Non-blocking: `PipelineRunRepository.scala` was 849 lines and is now 863. CONTRIBUTING.md says to propose a split in
   the PR description once a file passes ~400 lines.

### Phase 3: UI Review — N/A
Backend repository-only change. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file is touched.

### Overall: FAIL

### Change Requests
1. Regenerate `openspec/changes/pipeline-run-order-tiebreak/mutations.txt` entries M05–M08 against the correct sites in
   `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala`:
   - M05: `listByPipelineInternal`, line 573.
   - M06: `latestRunInternal`, line 589.
   - M07: `latestNonDryRunInternal`, line 602.
   - M08: `latestRunIdsInternalBatch`, line 701.

   Apply one mutation at a time, change only the named line, and restore with `git checkout HEAD -- <file>`. Record the
   actual failing test names and counts. Expected, from my reruns: M05 = listByPipelineInternal plus the route test
   (2); M06 = latestRunInternal plus the route test (2); M08 = both batch tests plus the route test (3). Also re-verify
   M04 (`listByPipeline`, line 563): confirm it fails the listByPipeline (RLS pool) test, and add a `git diff` of each
   mutated line to the record so the site is self-evident. Update the Evidence note in `tasks.md` if the totals change.

### Non-blocking Suggestions
- In `PipelineRunOrderTiebreakSpec.scala:110-114`, drop the redundant `UPDATE` and the duplicated comment line.
- Remove the stray blank line at `PipelineRunRepository.scala:37`.
- In the PR body, note the 863-line `PipelineRunRepository.scala` as a split candidate (pre-existing size).
- The `%05d` assertion-id index keeps evaluation order only up to 100,000 assertions per run. That is fine in practice,
  but a one-line comment would say so.

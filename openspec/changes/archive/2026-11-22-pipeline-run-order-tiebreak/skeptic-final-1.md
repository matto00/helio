## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `77fda2f0a0488f227c7410f9210ea699835614f8`; base resolved live via `resolve-review-base.sh` =
`3dca8306ab72903544872ab9ddcf6b11f8d175a5`. Backend-only change (no frontend, schema, helio-mcp or migration files in
`git diff --name-only base...HEAD`), so the UI/design step does not apply and no servers were started.
Scratch output: `/home/matt/Development/helio/.concertino/scratch/HEL-1626/skeptic-*.txt`.

### What I verified (with evidence)

- **Diff.** Code changes are confined to `PipelineRunRepository.scala` (run reads -> `(startedAt.desc, id.desc)`; reaper
  `NOT EXISTS` -> row-value `(n.started_at, n.id) > (r.started_at, r.id)`; three assertion reads -> `(createdAt, id)`;
  `insertAssertions` ids -> `<batch UUID>-%05d`; read-only `createdAt` column on the Slick assertion table, `*`
  projection unchanged so inserts keep the DB default) and `HomeSummaryRepository.scala:29` (`r.started_at DESC, r.id DESC`).
- **Inventory completeness (my own grep, not the design table).** Every `pipeline_runs` / `pipeline_run_assertions`
  read in `backend/src/main` lives in `PipelineRunRepository` or `HomeSummaryRepository` (grep for the table names,
  `runsTable`, `assertionsTable`, `started_at`). Every ordering/latest-pick site is changed: `listByPipeline`,
  `listByPipelineInternal`, `latestRunInternal`, `latestNonDryRunInternal`, `latestRunIdsInternalBatch` (fold keeps first
  per pipeline), `deleteOldRunsInternal` newestN + capped, `deleteOldDryRunsInternal`, the reaper, Home load, and the three
  assertion reads. Callers traced: run-history and `runs/latest` and context-details via `PipelineRunQueries`;
  assertion-status, panel-status (`DashboardPanelStatusService` -> `AssertionStatusRule`) and provenance via
  `latestNonDryRunInternal`. `PipelineContextAnalyzeReads` (HEL-1625) reads no runs. In-memory consumers
  (`HomeSummaryBuilder` sortBy/maxBy, `groupBy` in the batch assertion read, `Future.traverse` in run-history) preserve the
  SQL order. Left-alone reads (`latestSuccessfulCompletedAtInternal` max scalar, active-run exists/find, in-flight count,
  terminal writes by run id) do not order runs.
- **Red is genuine.** I checked out the base versions of the two main files only (`git checkout 3dca8306a -- <2 files>`),
  ran the HEAD `PipelineRunOrderTiebreakSpec`, then restored (`git status` clean afterwards): `Tests: succeeded 11, failed 15`,
  the exact failing set recorded in `red-run-2.txt` (`skeptic-final-base.txt`). Every changed read has at least one red
  test there. Commit order holds C1: spec + `red-run-1.txt` in `21e4601ec`, `red-run-2.txt` in `fe52c1386`, fix in
  `be1bad125`.
- **Green at HEAD.** `testOnly ...PipelineRunOrderTiebreakSpec`: `Tests: succeeded 26, failed 0`, hel1468 guard
  `failed=0` (`skeptic-final-head.txt`).
- **Per-site guards by mutation (independent of mutations.txt).** I re-ran three single-site mutations, each restoring the
  file afterwards: M02 capped (`:514` -> `sortBy(_.startedAt.desc)`) -> 1 red (cap test, greater id last);
  M12 batch assertions (`:714` -> `createdAt` only) -> 1 red (same-created_at test); M09 reaper (`:422` ->
  `n.started_at > r.started_at`) -> 1 red (leave last_run_* alone). These match `mutations.txt` entries M02/M12/M09; the
  evaluator independently re-ran M01/M04-M08. Every site in the diff has a recorded mutation (M01-M15).
- **Tests force the tie deterministically.** Fixed `started_at`/`created_at`, hand-picked ids, and both insertion orders
  for every runs read, so an un-tie-broken query is wrong in at least one order (the base run shows exactly that pattern:
  "greater id last" fails across the board). No reliance on clock collisions or random ids.
- **RLS context.** `listByPipeline`, `listAssertionsByRun` and `HomeSummaryRepository.load` are exercised through the
  fixture's `ctx` (TwoUserRlsApiFixture, `helio_app_test` pool); the spec's last test asserts
  `rolbypassrls = false, rolsuper = false` for `current_user` inside `withUserContext`, and it passed in my run.
- **Goldens unchanged.** No file under `helio-mcp/` or `shared-test-fixtures/` is in the diff. Related backend suites
  (16 suites incl. `PipelineContextDetailsRoutesSpec`, `PipelineContextAnalyzeRoutesSpec`,
  `PipelineContextAnalyzeQueryCountSpec`, `DashboardPanelStatusRoutesSpec`, `HomeSummaryScopingSpec`,
  `OrphanedRunReaperSpec`, `RunReaperConcurrencySpec`, `PipelineRunRepositorySpec`, `PipelineRunRoutesSpec`,
  `Provenance*`, `HookRoutesSpec`, `OutputRoutesSpec`): `Tests: succeeded 277, failed 0` (`skeptic-final-related.txt`).
- **Assertion id format change is invisible.** Column is `TEXT` (V84:20); no service reads assertion row ids
  (`PipelineRunQueries`/`ProvenanceService`/`AssertionStatusRule` only map fields); the only insert path is
  `insertAssertions`.
- **No migration.** Latest migration is still V146. `explain-analyze.txt` shows `LIMIT 1` moving to an incremental sort
  presorted on `started_at` (0.041 ms -> 0.071 ms) and the full list unchanged in shape; no index needed.

### Verdict: CONFIRM

### Non-blocking notes

- The "left alone" reason for `findActiveRunInternal` (design.md D4: "at most one open run per pipeline (overlap guard)")
  is not quite true. The overlap guard covers the scheduler, hook and auto-run paths, but manual `PipelineRunService.submit`
  does not check for an open run, so two manual runs can be open together and the hook's `collapseIntoActiveRun` then
  returns an arbitrary one (`.result.headOption`, no ORDER BY). This is not a latest-run or run-ordering read, so it is
  outside this ticket's AC. The PR should give an accurate reason (e.g. "picks an active run, not the latest; a
  multi-open-run case only arises from overlapping manual submits"), and a follow-up could add the same order there.
- design.md D5 says runs per pipeline are "capped by retention at about 20". The real cap is `RetentionMaxRuns` (300)
  inside the 24 h window. The measured plan still holds: the incremental sort only sorts the first `started_at` group
  for `LIMIT 1`. Correct the number in the PR text.
- The PR must list reads changed and left alone, each with a reason, and state that `id DESC` is deterministic and not
  "more recent" (AC 1/2). The code comments already say this. The delivery step has to carry it into the PR body.

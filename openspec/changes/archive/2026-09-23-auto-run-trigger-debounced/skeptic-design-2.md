## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Round 1's specific finding is now fully resolved, verified against the current design.md/
  tasks.md text (not the orchestrator's summary).** Read design.md's Context bullet 2 and the new
  "Decision 2a" section, and tasks.md 1.5/2.1/3.10 in full. The revision:
  - Extracts only the ACL-*insensitive* part of `analyze`'s gathering (root-list resolution,
    dataset-row-count lookup, `CostInput` assembly) into `PipelineCostInputGathering.gather(...)`,
    with root-to-`DataSource` resolution threaded in as a `resolveRoot: DataSourceId =>
    Future[Option[DataSource]]` parameter supplied by the caller.
  - `PipelineService.analyze` passes `dsId => dataSourceRepo.findByIdOwned(dsId, user)` — unchanged
    behavior.
  - `AutoRunTriggerService` passes `dsId => dataSourceRepo.findByIdInternal(dsId)` — privileged, no
    writer-ACL dependency on the pipeline's other roots.
  - This is exactly what round 1 asked for, and directly closes the misclassification path: a
    co-root now resolves via the same privileged lookup the pipeline's own run-execution path
    already uses, not the writer's ownership.
  - New task 3.10 requires a multi-root, mixed-ownership probe with an explicit "must fail red
    against the original `findByIdOwned`-reusing design" requirement — the right shape to prove the
    fix is load-bearing, not just present.

- **The proposed `resolveRoot` signature is mechanically compatible with both call sites — verified
  against the actual running code, not inferred.** Read `PipelineService.scala` lines 880-1051 (the
  real `analyze` implementation) directly:
  - `analyze`'s existing root fetch is `pipelineRepo.listRootDataSourceIdsInternal(pipelineId)` →
    `Future.traverse(...) { dataSourceRepo.findByIdOwned(dsId, user) }` → `dataSourceRepo
    .countDatasetRows(datasetRootIds)` → assemble `costRoots`/`costSteps` → `CostInput(costSteps,
    costRoots, summary.lastRunRowCount)`. This is precisely the shape `gather(pipelineId,
    enabledSteps, lastRunRowCount, resolveRoot)` needs to internalize, with `resolveRoot` swapped in
    for the `findByIdOwned` call.
  - `DataSourceRepository.findByIdInternal(id: DataSourceId): Future[Option[DataSource]]` (lines
    136-144) has the **identical signature** to `findByIdOwned(id, user)` partially applied to a
    fixed `user` — both satisfy `DataSourceId => Future[Option[DataSource]]` with no adapter needed.
  - The cited precedent, `PipelineRunService.resolveAllRootDataSourcesInternal` (lines 297-301),
    confirmed doing exactly this: `listRootDataSourceIdsInternal` + per-root `findByIdInternal` —
    the pattern design.md Decision 2a claims to mirror is real, not invented.
  - `PipelineCostEstimator.CostInput`/`RootCost`/`StepInput` (domain/engine/PipelineCostEstimator
    .scala lines 61-79) match the fields `gather` needs to assemble — no shape mismatch.

- **`findLastRunRowCountInternal` is trivially correct as scoped.** `pipelines.last_run_row_count`
  (`PipelineRepository.scala` line 677) is a plain `Option[Long]` column already denormalized onto
  the `pipelines` table itself — a privileged one-column `SELECT ... WHERE id = ?` under
  `withSystemContext` is exactly the "mirrors this file's existing small internal-getter
  convention" design.md claims; no ACL logic is needed or omitted.

- **Moving `hasSourceUrl` into the shared object does not break `PipelineService`.** Grepped every
  reference to `hasSourceUrl` in the backend tree: the only call site is inside `analyze`'s own
  `costRoots` construction (line 1010), which is itself moving into the shared helper. No other
  method in `PipelineService` (or elsewhere) calls it. Confirmed safe.

- **Test 3.10's scenario is realistically constructible against real service semantics**, not
  hypothetical. Read `PipelineService.addRoot` (lines 795-820): a root's data source is resolved via
  `dataSourceRepo.findByIdOwned(dsId, user)` where `user` is the ADDING user (owner or, via
  `requireEditorAccess`, an editor grantee) — confirming design.md Context's claim that a pipeline
  owner and a root's data-source owner can differ, and that a multi-root, mixed-ownership pipeline
  is buildable through existing, unmodified service methods for the test.

- **Nothing else in the document changed in a way that reopens round 1's other confirmed findings.**
  Re-read design.md in full: Decisions 1, 3, 4, 5 and the unrelated Context bullets are unchanged in
  substance from what round 1's report quoted and verified (scheduler TOCTOU non-exclusivity, V62
  RLS-pattern precedent, non-cascade hook-point argument, `trigger_source` constraint widening,
  30s tick interval). Re-verified the two structural SQL facts round 1 checked independently
  survive verbatim in the current file: the `DROP/ADD CONSTRAINT` SQL (Decision 1) and the
  claim/release SQL (Decision 3) are byte-identical to what round 1 already confirmed against the
  live migration/constraint state.

### Verdict: CONFIRM

### Non-blocking notes

- `DataSourceRepository.findByIdInternal`'s own header comment (lines 135-141) enumerates a fixed
  "Permitted callers" list that does not yet name the new `PipelineCostInputGathering`/
  `AutoRunTriggerService` caller. Likewise `countDatasetRows`'s header comment (line ~163) asserts
  "ACL is enforced earlier, by the caller resolving `ids` via `findByIdOwned` in the first place" —
  no longer true for the auto-run path (which resolves via privileged `findByIdInternal`, correctly
  so). Neither is a functional defect (both methods are already privileged/ACL-free at the query
  level; only the doc comments describing *why* that's safe go stale), but the executor should
  update both comments alongside the 1.5 refactor so they don't mislead a future reader into
  thinking `countDatasetRows`'s safety still depends on `findByIdOwned` having run first.
- `enabledSteps`'s source for the `AutoRunTriggerService` call site isn't spelled out in task 2.1 —
  it will need `pipelineStepRepo.listByPipelineInternal(pipelineId)` (confirmed privileged/ACL-free,
  `PipelineStepRepository.scala` line 346), filtered to `.enabled`, mirroring `analyze`'s own
  `allSteps.filter(_.enabled)`. Trivial to fill in at implementation time; not worth a task-list
  edit.

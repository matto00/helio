## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 3dca8306ab72903544872ab9ddcf6b11f8d175a5 (change dir untracked). Read ticket.md, proposal.md,
design.md, tasks.md, specs/pipeline-run-deterministic-order/spec.md, and the live code.

### What I verified (with evidence)

**Inventory completeness (D3/D4) against the live code.**
- Every `sortBy(_.startedAt.desc)` in `PipelineRunRepository.scala` (lines 497, 506, 535, 554, 564, 580, 593, 689) maps to a D3 row:
  `deleteOldRunsInternal` newestN/capped, `deleteOldDryRunsInternal` keepIds, `listByPipeline`, `listByPipelineInternal`,
  `latestRunInternal`, `latestNonDryRunInternal`, `latestRunIdsInternalBatch`. None is missing.
- The only other `pipeline_runs` ORDER BY in main code is `HomeSummaryRepository.scala:29` (`ORDER BY r.started_at DESC`), which is in D3.
  A grep of `pipeline_runs|PipelineRunTable|pipeline_run_assertions` across `backend/src/main` turns up no other query site. The other hits are comments, writes and protocols.
- The reaper's `NOT EXISTS ... n.started_at > r.started_at` (line 414) is in D3. Its row-value replacement uses the same collation as the ORDER BY, so the reaper and the latest-run reads agree.
- The three assertion reads (`listAssertionsByRun` line 667, `listAssertionsByRunsInternalBatch` 699, `listAssertionsByRunInternal` 709) have no ORDER BY today. All three are in D3. `groupBy(_.runId)` in the batch read keeps the order within each group, so ordering the SQL is enough.
- HEL-1786 panel-status: `DashboardPanelStatusService.scala:95` goes through `AssertionStatusRule.latestRealRunAssertions`, which calls `latestNonDryRunInternal` and then `listAssertionsByRunInternal`. Both are covered. Its `lastRunAt`/`runStatus` come from `pipelines.last_run_*` (`PipelineRepository.findByIdsInternal`), and no query picks a run there.
- HEL-1625 context-analyze: `PipelineContextAnalyzeReads.scala:35-49` reads summaries, steps, roots and sources, and no runs. D4 is correct.
- HEL-1815 run-history and HEL-1619 context-details: `PipelineRunQueries.scala:101` (`listByPipelineInternal` plus a per-run `listAssertionsByRunInternal`) and `:130-131` (the batch pair) are covered. `runs/latest` is at `:44`, through `latestRunInternal`, and is covered.
- Provenance: `ProvenanceService.scala:69,172` uses `latestNonDryRunInternal` and `listAssertionsByRunInternal`, and both are covered.
- HEL-1511 reaper: `OrphanedRunReaper.scala:29` calls `reapStaleRunsInternal`, which is covered.
- Home: the in-memory sorts in `HomeSummaryBuilder.scala:62` (`sortBy(-epochMilli)`, stable) and `:83` (`maxBy`, first max) keep the SQL order on ties. D4's reasoning holds.
- helio-mcp: `helio-mcp/src` does not re-sort runs, and it only consumes server order (the `context.ts` and `contextBudgetFixture.ts` hits). The frontend has no `startedAt` sort or `[0]` pick.
- The D4 items `latestSuccessfulCompletedAtInternal` (`max`), `hasActiveRunInternal` (`exists`) and `findActiveRunInternal` (`headOption` under the single-open-run invariant) are correctly left alone.

**D2 (assertion id format).** The planner self-approved this, and I agree it does not need escalation:
- `pipeline_run_assertions.id` is `TEXT PRIMARY KEY` with no format constraint (`V84__pipeline_run_assertions.sql:20`). No API exposes it: `summarizeAssertions` (`PipelineRunQueries.scala:196-204`) emits kind, field, severity and message only. Test code does not parse assertion ids as UUIDs (grep of `backend/src/test`).
- Order is observable only in run-history and context-details `failures`. Assertion-status, panel-status and provenance only count rows, so their order is not observable.
- `insertAssertions` is called once per run (`PipelineRunTerminalWrites.persistAssertions`, line 140) with an `AssertionSink` vector in evaluation order. One batch prefix per run plus a zero-padded index therefore gives `id ASC` equal to evaluation order. Different batches get different `created_at` values (separate transactions), so `created_at` orders them first.
- This keeps the order users see today, and the change is an internal storage detail. It is not a product decision. The semantic-key alternative would visibly reorder failures. The `position` column needs a migration that the ticket says to avoid.

**Can the tests go red?**
- Runs: with equal `started_at`, the un-tie-broken order comes from the index or heap, which is in practice insertion order. Task 2.1 inserts both orders with chosen ids, so one of the two cases is red without the fix. Mutation testing (2.6) covers the rest.
- Assertions: rows inserted directly in non-id order come back in heap order without an ORDER BY, so that case is red. See note 2 for the "insert order preserved" case.
- Retention: see note 3.

### Verdict: CONFIRM

### Non-blocking notes
1. **D3 lists the wrong consumers for `listByPipeline` and `listAssertionsByRun` (the RLS-context reads).** It says they feed the "owner run list" and run-history, but no code in `backend/src/main` calls either one (grep for callers: no hits). Changing and RLS-proving them (2.5) is still fine. The PR's list of changed reads should say "no production caller" rather than claim a feed.
2. **Task 2.3, "insert order preserved for new rows":** with only 2 or 3 rows, random-UUID ids plus `ORDER BY id` would pass by chance 50% or 17% of the time. Use 8 or more rows in the insert-order test, so it fails reliably once D2's id format is removed. Also make the mutation in 2.6 revert D2 to `UUID.randomUUID()`.
3. **Task 2.2, retention:** `deleteOldRunsInternal` keeps every real run started in the last 24 hours (`inWindow`). A tied boundary test of `newestN` must use `started_at` values older than the window. Otherwise it should test the `capped` (RetentionMaxRuns) path. If not, the test passes vacuously.
4. **The `created_at` column is not mapped in `PipelineRunAssertionTable`** (lines 836-847). The implementer needs a `createdAt` column def outside `*`, or plain SQL, to order by it.
5. **The AC requires "failing-first per read".** Tasks 2.1 and 2.2 say red first, but 2.3 and 2.4 do not. Apply red-first and a committed `.txt` to them too.
6. **Legacy assertion rows lose their heap-order display.** For runs still retained, rows will now sort by their random UUIDs. The order is deterministic but different from what users saw before. Retention ages these runs out in about 24 hours or after 20 runs. State this in the PR.
7. **Task 2.7 (MCP goldens):** the golden tests use fixture servers (`contextBudgetFixture.ts`), so they cannot react to a backend ordering change. Running them confirms nothing changed in the goldens, but it does not prove ordering parity. Do not present it as ordering evidence.

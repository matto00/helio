## Why

`node_snapshots` keeps only the latest materialization of each node, so Helio cannot show a delta ("up 12% vs 7d"), a sparkline, or an alert baseline. HEL-918 is the foundation for those; this leaf (L1) lays the storage, the summary computation and the transactional write path that every later leaf (L2 retention, L3 read API + compare, L6 payloads, L8 alert baselines) builds on, following owner rulings D1–D10.

## What Changes

- New Flyway migration `V115__output_snapshot_history.sql`: table `output_snapshot_history` (UUID PK, `output_id` FK → `outputs(id)` ON DELETE CASCADE, `pipeline_id`, `node_step_id`, `root_id`, `run_id TEXT NULL` without FK, `trigger_source`, `captured_at`, `row_count`, `summary JSONB`), index `(output_id, captured_at DESC)`, ENABLE + FORCE RLS with sharing-aware policies via `helio_can_access_pipeline(pipeline_id)` (the V94 `node_snapshots` policy shape), explicit GRANT to `helio_privileged` (the V113 grant pattern).
- New pure `OutputSummaryReducer` (backend domain): a faithful port of `frontend/src/utils/aggregate.ts` `computeAggregate`/`groupAndAggregate` including the JS `Number(string)` coercion grammar, plus per-numeric-column `{count,sum,min,max}` (cap 20 columns), the headline metric value for metric Outputs, and the reduced chart x→y series for chart Outputs (cap 200 points).
- New `OutputHistoryRepository` with the full primitive set later leaves need: `insertAction` (DBIO, composable), `listRecent`, `nearestAtOrBefore`, `earliest`, `thinAndPurge`.
- `NodeSnapshotRepository.overwriteRows` refactored to expose its replace as a composable `DBIO`; a new entry point runs the replace and the history insert in ONE transaction (D9). The HEL-947 backfill path keeps calling the history-free entry point.
- `PipelineRunService.onUnblockedRunSuccess` computes one summary per Output on each materialized node and writes it in that node's transaction — only on real, unblocked, successful runs (D5). `triggerSource` is threaded down to it.
- `Main.scala` / `ApiRoutes.scala` construct and expose the history repository (pre-wiring for L2/L3/L8; no new routes, no retention scheduling).

## Capabilities

### New Capabilities
- `output-snapshot-history`: per-Output summary history recorded on every real successful run — storage, RLS, the summary reducer contract, the transactional write path, exclusions, and the repository read/purge primitives.

### Modified Capabilities
<!-- none: node_snapshots replace semantics are unchanged; history is additive -->

## Impact

- Backend: `db/migration/V115__output_snapshot_history.sql`, `NodeSnapshotRepository.scala`, new `OutputHistoryRepository.scala`, new `OutputSummaryReducer.scala`, `PipelineRunService.scala`, `OutputRepository` (no change expected — reuses `findConfigsByIdsInternal`), `Main.scala`, `ApiRoutes.scala`.
- Tests: new reducer spec + Jest fixture test over `shared-test-fixtures/output-summary-reducer.json`; repository spec; run-path spec; RLS proof spec; `RlsPolicyGuardSpec`, `RlsPrivilegedDmlSpec`, `FlywayNonSuperuserMigrationSpec` updates.
- Per-run cost: one extra batch config query per run, one multi-row INSERT per materialized node, and in-memory reduction over the node's rows (measured and reported).
- No API, frontend, or MCP surface change.

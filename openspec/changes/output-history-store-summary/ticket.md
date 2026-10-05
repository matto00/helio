# HEL-1271: HEL-918 L1: Output history store, summary reducer and transactional write path

## Description

Owner rulings for HEL-918 (2026-10-05) — binding:

* D1 Storage: summary first. Every real run stores a per-Output summary: row_count, per-numeric-column {count,sum,min,max} (cap ~20 columns), the server-computed headline metric value, and the reduced chart x→y series (cap ~200 points). Full row payloads come later (L6), opt-in, with tight retention, as one JSONB array per node per run.
* D2 `compare` lives on outputs.config.compare (previous_run | 1d | 7d | 30d | custom:<ISO-8601 duration>), not on the panel, and not on place_outputs.
* D3 Canonical metric: compute it server-side over ALL rows (unfiltered), with a port of frontend computeAggregate. The metric headline ALSO switches to the server value, which fixes today's first-200-rows error. With a viewer control filter active, the delta is hidden, with the tooltip "comparison reflects unfiltered data".
* D4 Retention: write every run, then thin on purge: within 24h at most 1 point per 5 min; 1–7 days at most 1 per hour; beyond that at most 1 per day, up to the tier max age (free 30d, beta 90d, owner 365d). Env-driven config (PipelineRunGuardConfig style). Payload tier caps (L6): free 0, beta 10 runs/7d, owner 30 runs/30d.
* D5 Only real, unblocked, successful runs record history. Not dry runs, previews, blocked runs, failed runs or write-back failures, and not the HEL-947 output backfill.
* D6 Baseline = the nearest point at or before (latest point captured_at − window), measured from the latest snapshot. If there is none, return baseline null plus availableFrom; the UI shows "7d comparison available from <date>". previous_run = the second-newest point.
* D7 run_id TEXT NULL with no FK, plus trigger_source and captured_at on the history row. pipeline_runs keeps only 10 runs, and grantee runs have no row.
* D8 Keyed by output_id, FK ON DELETE CASCADE, UUID PK (no BIGSERIAL, because of the TRUNCATE-cascade sequence landmine). pipeline_id is stored too. Sharing-aware RLS via helio_can_access_pipeline, mirroring node_snapshots. Access through the privileged pool behind outputRepo.findById. Public dashboards get the summary, never payloads.
* D9 The summary insert is in the same per-node overwriteRows transaction as the snapshot replace (refactor it to compose a DBIO). It is not best-effort.
* D10 Alert baselines go last (L8). Alerts are API-only today.

Corrections to the epic text (verified against main 5ae66fc1): no NodeSnapshotStore interface (NodeSnapshotRepository is concrete and nullable); PipelineRunService writes snapshots node by node, each in its own transaction; node_snapshots stores one row per data row and has no run_id; seconds-cadence pipelines don't exist; HEL-910 is Done.

## Scope

* Migration V115 creates `output_snapshot_history` (id UUID PK, output_id FK ON DELETE CASCADE, pipeline_id, node_step_id, root_id, run_id TEXT NULL, trigger_source, captured_at, row_count, summary JSONB), index (output_id, captured_at DESC). Sharing-aware RLS via helio_can_access_pipeline, ENABLE + FORCE, explicit GRANT to helio_privileged.
* New OutputHistoryRepository with ALL read and purge primitives later leaves need (listRecent, nearestAtOrBefore, thinAndPurge).
* New pure OutputSummaryReducer porting frontend/src/utils/aggregate.ts computeAggregate, plus column stats and the chart series.
* Compose the summary insert into the per-node NodeSnapshotRepository.overwriteRows transaction, for real unblocked runs only.
* Pre-wire the history repo into Main.scala/ApiRoutes.scala so L2/L3/L8 don't collide on wiring.

## Acceptance Criteria

* Red/green spec: two real runs → 2 history rows. A dry run, a blocked run, a failed run, a write-back failure and an HEL-947 backfill each → 0.
* A failing history insert rolls back the snapshot replace.
* Deleting an Output cascades its history.
* The reducer matches aggregate.ts on shared fixtures (including string-number coercion).
* Non-BYPASSRLS RLS proof as helio_app_test: owner and grantee can SELECT, a non-grantee sees 0, an INSERT without context is rejected.
* RlsPolicyGuardSpec and RlsPrivilegedDmlSpec updated. The migration runs under FlywayNonSuperuserMigrationSpec.
* Each repository primitive (listRecent, nearestAtOrBefore, thinAndPurge) has a unit test.
* Added per-run cost (extra query count and time on a ~1000-row node) is measured and reported.

## Depends on

None.

# HEL-1273: HEL-918 L3: History + delta read API and config.compare validation

## Description

Owner rulings for HEL-918 (2026-10-05):

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

Corrections to the epic text (verified against main 5ae66fc1):

* There is no NodeSnapshotStore interface; NodeSnapshotRepository is concrete and nullable.
* PipelineRunService writes snapshots node by node, each in its own transaction (PipelineRunService.scala ~1388-1431); the engine does not persist.
* node_snapshots stores one row per data row and has no run_id.
* Seconds-cadence pipelines (HEL-917) don't exist: the floor is a 1-min cron, the 30s scheduler tick, and the 10 runs/min/user guard.
* HEL-910 is Done.

## Scope

* GET /api/outputs/:id/history?limit=30&since=.
* compare resolution per D6, returning {current, baseline, delta, pct, availableFrom, sparkline[]}.
* A public allow-listed variant (summary only).
* OutputService validates config.compare (previous_run|1d|7d|30d|custom:<ISO dur>), 400 if invalid.
* Schemas in schemas/ updated.

## Acceptance

* Red/green on nearest-before, including no baseline → null + availableFrom.
* A non-grantee gets 404 with no existence leak (HEL-1002 semantics).
* A bad compare → 400.
* A bounded query count.

## Driver brief additions (binding for this run)

* Schemas in `schemas/` updated, plus a seam test of the response shape.
* If it touches sharing visibility, a non-BYPASSRLS proof.
* New route specs extend `com.helio.testkit.HelioRouteTest`.
* Use L1's `OutputHistoryRepository` (`listRecent`, `nearestAtOrBefore`, `earliest`) and the pre-wired `outputHistoryRepoOpt`; do not reimplement queries. No migration.
* This lane owns OutputRoutes, OutputService, PublicDashboardRoutes and the protocol; keep ApiRoutes and Main hunks minimal (parallel lanes HEL-1272 L2 and HEL-1278 L8).
* L1 divergences to honour: after thinning, previous_run means the previous *retained* point (document in API/schema); `columns.count` is the count of coercible cells; root_id is NULL for step-bound history rows; the stored headline metric value is server-computed over all rows and must be exposed consistently.

## Touches

OutputRoutes.scala, OutputService.scala, a protocol file, PublicDashboardRoutes.scala, schemas/.

## Depends on

L1 (HEL-1271, merged 1606ba8c, PR #765).

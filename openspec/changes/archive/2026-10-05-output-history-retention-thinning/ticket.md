# HEL-1272: HEL-918 L2: History retention — tiered time-bucket thinning on the scheduler tick

## Description

Owner rulings for HEL-918 (2026-10-05), binding — D4 especially:

* D4 Retention: write every run, then thin on purge: within 24h at most 1 point per 5 min; 1–7 days at most 1 per hour;
  beyond that at most 1 per day, up to the tier max age (free 30d, beta 90d, owner 365d). Env-driven config
  (PipelineRunGuardConfig style). Payload tier caps (L6): free 0, beta 10 runs/7d, owner 30 runs/30d.
* D5 Only real, unblocked, successful runs record history.
* D8 Keyed by output_id, FK ON DELETE CASCADE, pipeline_id stored too. Sharing-aware RLS via helio_can_access_pipeline.
  Access through the privileged pool.
* (D1–D3, D6, D7, D9, D10: see the epic; not in this leaf's scope.)

Corrections to the epic text: there is no NodeSnapshotStore interface; seconds-cadence pipelines don't exist (floor is a
1-min cron, the 30s scheduler tick, and the 10 runs/min/user guard).

## Scope

* OutputHistoryRetentionService, driven from PipelineSchedulerService.tick following the ProductEventRollupService
  precedent (an hourly purgeIfDue). It thins and purges per D4, resolving the tier in SQL
  (history → pipelines.owner_id → users.tier).
* An env-driven OutputHistoryRetentionConfig.

## Acceptance Criteria

* A fake-Clock spec seeds points across 40 days for free and owner Outputs and asserts the exact survivors.
* A second tick within the hour is a no-op.
* A purge failure is logged and never fails the tick.
* The purge runs on the privileged pool, proven against the two-role topology (RlsPrivilegedDmlSpec pattern), with a
  non-BYPASSRLS check.

## Driver notes (claims — verify)

* L1 (HEL-1271, 1606ba8c, PR #765) shipped `OutputHistoryRepository.thinAndPurge` and `HistoryThinningPolicy` with the
  D4 defaults; build on them; prefer not to change the repository, keep any change minimal.
* L1 recorded: `thinAndPurge` never age-purges a tier missing from `maxAgeByTier`. Decide whether an unknown tier falls
  back to the strictest (free) cap, and test it.
* No migration expected (escalate for a number if one is needed). Parallel lanes HEL-1273 (L3) and HEL-1278 (L8);
  keep Main.scala / PipelineSchedulerService.scala hunks minimal.

## Touches

PipelineSchedulerService.scala, Main.scala, the new service and config.

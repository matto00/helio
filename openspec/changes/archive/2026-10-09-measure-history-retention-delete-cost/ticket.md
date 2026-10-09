# HEL-1284: Measure output-history thinning DELETE at production scale; index if it full-scans

## Description

origin_kind: followup
origin_ticket: HEL-1272

The HEL-1272 retention pass runs `OutputHistoryRepository.thinAndPurge` hourly on the scheduler tick, on the privileged pool. Its thinning DELETE scans the whole `output_snapshot_history` table. It took about 20 ms on the 40-day test fixture, but nobody has measured it at production scale or at a projected multi-tenant volume.

## Acceptance Criteria

- `EXPLAIN (ANALYZE, BUFFERS)` of the thin DELETE and the age-purge DELETEs, on a seeded table at realistic volume: for example 1k outputs × 1 year of 5-minute points before thinning. Record the plan and the timings.
- If either DELETE seq-scans the full table where an index would bound it, add the index in a migration and show the before and after plans. Coordinate the migration number with the driver.
- State the measured cost per tick, and whether the hourly cadence and advisory lock are still appropriate at that scale.

## Driver context (verified at Setup; see premise-validation evidence)

- Retention pass today (origin/main 023aa4bb) = `OutputHistoryRepository.thinAndPurge` (per-tier age purges + unnamed-tier catch-all + HEL-1285 protected-newest-101 thin) followed, in the same gate, by `NodePayloadHistoryRepository.purge` (HEL-1276: disallowed-tier, per-tier age, per-node newest-N, unreferenced) — both under the HEL-1272 advisory lock, privileged pool, gated by `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES` (default 60) with the HEL-1343 lock-retry window.
- Do NOT seed the shared dev DB `helio`. Use a dedicated scratch database, Flyway-migrated to origin/main head, dropped by exact name afterwards.
- Hardware: 6-core desktop. Tractable scale (1–10M rows), `nice -n 19`, ≤3–4 workers. Extrapolate with stated assumptions; model the thinned steady state.
- Migration number, if an index is warranted: V120 (V119 is HEL-1347's, in flight).

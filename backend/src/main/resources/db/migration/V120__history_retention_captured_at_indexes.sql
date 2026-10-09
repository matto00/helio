-- HEL-1284: bound the history-retention tick's age-purge DELETEs.
--
-- OutputHistoryRepository.thinAndPurge's per-tier age purges and NodePayloadHistoryRepository.purge's
-- per-tier payload age purge filter on `captured_at < cutoff`, but no index leads with captured_at: on a
-- planner without btree skip scan (production is PostgreSQL 16; skip scan is PG 18+) each one reads the
-- whole table to delete a handful of rows. Measured at 10k Outputs / ~5M history rows (mixed tiers),
-- on a PG 18 server with its leading-column indexes hidden to mimic PG 16: the three named-tier history
-- age purges read ~5.0M rows each (~15M rows, ~810 ms together); with this index they read ~0.45M rows in
-- total (~150 ms). The payload table is small (bounded by tier caps), so its index is inexpensive insurance
-- (saves ~0.5 ms at 10k Outputs), included because the same rule selects it. The thin DELETE, which dominates
-- the tick (~10 s at 10k Outputs), uses neither index. See
-- openspec/changes/measure-history-retention-delete-cost/measurements.md.
--
-- Plain (captured_at) won over the join-driven (pipeline_id, captured_at) candidate on rows read,
-- buffers, time and insert cost. Plain CREATE INDEX, not CONCURRENTLY: the measured build is ~1 s at
-- 5M rows, production history is days old, and CONCURRENTLY can leave an INVALID index that
-- IF NOT EXISTS then silently keeps. The SHARE lock only delays history inserts for that long.
--
-- MUST NOT MERGE before HEL-1347's V119 is on origin/main: Flyway rejects a resolved-but-not-applied
-- version lower than the applied head, so shipping V120 first breaks V119 in production.
--
-- Additive only -- never edit this file once applied (shared dev DB; Flyway checksums the whole file).

CREATE INDEX IF NOT EXISTS idx_output_snapshot_history_captured_at
  ON output_snapshot_history (captured_at);

CREATE INDEX IF NOT EXISTS idx_node_payload_history_captured_at
  ON node_payload_history (captured_at);

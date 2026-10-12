-- HEL-1511 (design.md D1): liveness heartbeat for non-terminal real runs. The instance executing a run stamps
-- it every 30 s; the scheduler tick's reaper finalizes a non-terminal run whose heartbeat has gone stale
-- (PIPELINE_RUN_STALE_AFTER_SECONDS) as failed. NULL = never stamped (every row written before this migration,
-- and dry runs, which are inserted terminal); the reaper judges a NULL row by started_at against a longer legacy
-- bound. No backfill. Additive; old code ignores the column.
ALTER TABLE pipeline_runs ADD COLUMN heartbeat_at TIMESTAMPTZ NULL;

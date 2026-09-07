-- HEL-873: persist the run truncation signal so a reloaded page can still
-- distinguish a partial row count from a complete one.
--
-- No DEFAULT and no backfill on either column -- NULL is the deliberate
-- "not recorded" state for every row written before this migration (design.md
-- Decision 2). A backfilled value would assert a fact that was never
-- observed.
ALTER TABLE pipeline_runs
  ADD COLUMN truncated_reads JSONB NULL;

ALTER TABLE pipelines
  ADD COLUMN last_run_truncated BOOLEAN NULL;

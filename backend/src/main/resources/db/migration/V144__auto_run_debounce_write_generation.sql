-- HEL-1739 (design.md D1): a globally unique "write generation" per debounce row. Every
-- upsertDebounce (insert or conflict-update) draws a fresh value, so a run that snapshots the
-- generation before it reads source rows can cancel exactly the writes it read (compare-and-delete)
-- and never a write that landed later. A sequence, not a per-row counter: the row is deleted and
-- recreated, and a restarting counter would allow an ABA match. Additive; old code ignores the column.
CREATE SEQUENCE pipeline_auto_run_debounce_write_seq;
ALTER TABLE pipeline_auto_run_debounce
  ADD COLUMN write_generation BIGINT NOT NULL DEFAULT nextval('pipeline_auto_run_debounce_write_seq');
-- upsertDebounce, pendingWriteGeneration and cancelIfGeneration all run on the privileged pool.
GRANT USAGE, SELECT ON SEQUENCE pipeline_auto_run_debounce_write_seq TO helio_privileged;

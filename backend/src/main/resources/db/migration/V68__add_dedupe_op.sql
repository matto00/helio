-- HEL-382: extend the pipeline_steps op CHECK constraint to include 'dedupe'.
--
-- 'dedupe' is the fifth leaf of the HEL-336 Pipeline Op Expansion epic — a
-- pure row filter (no schema change, output schema == input schema, exactly
-- like 'limit'). Removes duplicate rows by whole-row equality (empty `keys`)
-- or by a key-set tuple (non-empty `keys`), honoring `keep = "first"|"last"`
-- by original input row order with a stable output order. Follows the
-- established V50__add_splittext_op.sql / V51__add_extractheadings_op.sql /
-- V52__add_chunkbytokencount_op.sql / V64__add_datebucket_op.sql /
-- V65__add_pivot_op.sql / V66__add_window_op.sql / V67__add_unpivot_op.sql
-- drop/re-add pattern (PostgreSQL has no ALTER CONSTRAINT for CHECK
-- constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount', 'datebucket', 'pivot', 'window', 'unpivot', 'dedupe'));

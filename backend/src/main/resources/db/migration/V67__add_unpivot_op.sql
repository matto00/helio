-- HEL-380: extend the pipeline_steps op CHECK constraint to include 'unpivot'.
--
-- 'unpivot' is the inverse of 'pivot' (HEL-375): for each input row, emits
-- one output row per `valueVars` column — `idVars` carried unchanged, plus
-- `varName` = the source column's name and `valueName` = that column's cell
-- value. Row count multiplies (`N input rows * len(valueVars) = N output
-- rows`), unlike `window`'s row-preserving shape. Follows the established
-- V50__add_splittext_op.sql / V51__add_extractheadings_op.sql /
-- V52__add_chunkbytokencount_op.sql / V64__add_datebucket_op.sql /
-- V65__add_pivot_op.sql / V66__add_window_op.sql drop/re-add pattern
-- (PostgreSQL has no ALTER CONSTRAINT for CHECK constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount', 'datebucket', 'pivot', 'window', 'unpivot'));

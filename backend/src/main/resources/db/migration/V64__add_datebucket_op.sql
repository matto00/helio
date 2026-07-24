-- HEL-378: extend the pipeline_steps op CHECK constraint to include 'datebucket'.
--
-- 'datebucket' floors a timestamp field to the start of a granularity bucket
-- (day/week/month/quarter/year), enabling grouping for the upcoming
-- time-series smart shape (HEL-337). Follows the established
-- V50__add_splittext_op.sql / V51__add_extractheadings_op.sql /
-- V52__add_chunkbytokencount_op.sql drop/re-add pattern (PostgreSQL has no
-- ALTER CONSTRAINT for CHECK constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount', 'datebucket'));

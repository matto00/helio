-- HEL-376: extend the pipeline_steps op CHECK constraint to include 'window'.
--
-- 'window' partitions rows by `partitionBy`, orders within each partition by
-- `orderBy`, and appends one derived column (`outputColumn`) per row via one
-- of six functions: row_number / rank / dense_rank / running_sum / lag /
-- lead. Row count is preserved (schema-additive, unlike `pivot`). Follows
-- the established V50__add_splittext_op.sql / V51__add_extractheadings_op.sql
-- / V52__add_chunkbytokencount_op.sql / V64__add_datebucket_op.sql /
-- V65__add_pivot_op.sql drop/re-add pattern (PostgreSQL has no ALTER
-- CONSTRAINT for CHECK constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount', 'datebucket', 'pivot', 'window'));

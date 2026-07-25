-- HEL-384: extend the pipeline_steps op CHECK constraint to include 'union'.
--
-- 'union' is the eighth leaf of the HEL-336 Pipeline Op Expansion epic — an
-- async / repo-touching op (like 'join') that stacks rows from a second
-- DataSource onto the current row set, in one of two modes: `byPosition`
-- (raw append, no column reconciliation) or `byName` (union of column names,
-- missing columns backfilled with null). Follows the established
-- V50__add_splittext_op.sql / V51__add_extractheadings_op.sql /
-- V52__add_chunkbytokencount_op.sql / V64__add_datebucket_op.sql /
-- V65__add_pivot_op.sql / V66__add_window_op.sql / V67__add_unpivot_op.sql /
-- V68__add_dedupe_op.sql / V69__add_fillnull_op.sql / V70__add_stringops_op.sql
-- drop/re-add pattern (PostgreSQL has no ALTER CONSTRAINT for CHECK constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount', 'datebucket', 'pivot', 'window', 'unpivot', 'dedupe', 'fillnull', 'stringops', 'union'));

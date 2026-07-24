-- HEL-389: extend the pipeline_steps op CHECK constraint to include 'stringops'.
--
-- 'stringops' is the seventh leaf of the HEL-336 Pipeline Op Expansion epic — a
-- per-value column transform (row count unchanged, exactly like 'cast') that
-- writes a derived string column via one of six operations: `trim`, `upper`,
-- `lower`, `split`, `extractRegex`, `concat`. Distinct from the row-exploding
-- `splittext` op. Follows the established V50__add_splittext_op.sql /
-- V51__add_extractheadings_op.sql / V52__add_chunkbytokencount_op.sql /
-- V64__add_datebucket_op.sql / V65__add_pivot_op.sql / V66__add_window_op.sql /
-- V67__add_unpivot_op.sql / V68__add_dedupe_op.sql / V69__add_fillnull_op.sql
-- drop/re-add pattern (PostgreSQL has no ALTER CONSTRAINT for CHECK constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount', 'datebucket', 'pivot', 'window', 'unpivot', 'dedupe', 'fillnull', 'stringops'));

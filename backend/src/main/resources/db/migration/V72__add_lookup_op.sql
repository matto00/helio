-- HEL-386: extend the pipeline_steps op CHECK constraint to include 'lookup'.
--
-- 'lookup' is the ninth and final leaf of the HEL-336 Pipeline Op Expansion
-- epic — an async / repo-touching op (like 'join' and 'union') that enriches
-- the current row set with a few named columns from a second DataSource (the
-- reference table) via a constrained single-key left-join: matching rows
-- bring in only `columns`; unmatched rows are null-filled for those columns
-- (row preserved); duplicate reference keys use the first match (no row
-- multiplication). Follows the established V50__add_splittext_op.sql /
-- V51__add_extractheadings_op.sql / V52__add_chunkbytokencount_op.sql /
-- V64__add_datebucket_op.sql / V65__add_pivot_op.sql / V66__add_window_op.sql /
-- V67__add_unpivot_op.sql / V68__add_dedupe_op.sql / V69__add_fillnull_op.sql /
-- V70__add_stringops_op.sql / V71__add_union_op.sql drop/re-add pattern
-- (PostgreSQL has no ALTER CONSTRAINT for CHECK constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount', 'datebucket', 'pivot', 'window', 'unpivot', 'dedupe', 'fillnull', 'stringops', 'union', 'lookup'));

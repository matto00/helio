-- HEL-375: extend the pipeline_steps op CHECK constraint to include 'pivot'.
--
-- 'pivot' reshapes long rows into wide rows: groups by `index` fields, and for
-- each distinct value of `column`, emits an output column whose cell is `agg`
-- over `values` for that group+value's rows — enabling matrix/crosstab panels
-- and the pivot/matrix smart shape (HEL-337). Follows the established
-- V50__add_splittext_op.sql / V51__add_extractheadings_op.sql /
-- V52__add_chunkbytokencount_op.sql / V64__add_datebucket_op.sql drop/re-add
-- pattern (PostgreSQL has no ALTER CONSTRAINT for CHECK constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount', 'datebucket', 'pivot'));

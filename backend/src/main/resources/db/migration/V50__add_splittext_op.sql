-- HEL-219: extend the pipeline_steps op CHECK constraint to include 'splittext'.
--
-- 'splittext' is the first of three planned "text ops" (HEL-220 extract
-- headings, HEL-221 chunk by token count follow) — splits a string-body
-- content field into one output row per paragraph or Markdown-heading
-- segment. Follows the established V31__add_aggregate_op.sql drop/re-add
-- pattern (PostgreSQL has no ALTER CONSTRAINT for CHECK constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext'));

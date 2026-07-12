-- HEL-220: extend the pipeline_steps op CHECK constraint to include 'extractheadings'.
--
-- 'extractheadings' is the second of three planned "text ops" (HEL-219
-- splittext preceded it, HEL-221 chunk by token count follows) — scans a
-- string-body content field for Markdown ATX heading lines and emits one
-- output row per heading found. Follows the established
-- V50__add_splittext_op.sql drop/re-add pattern (PostgreSQL has no ALTER
-- CONSTRAINT for CHECK constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings'));

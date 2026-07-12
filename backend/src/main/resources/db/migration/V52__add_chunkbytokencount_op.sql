-- HEL-221: extend the pipeline_steps op CHECK constraint to include 'chunkbytokencount'.
--
-- 'chunkbytokencount' is the third and final of three planned "text ops"
-- (HEL-219 splittext, HEL-220 extractheadings preceded it) — splits a
-- string-body content field into one output row per chunk of real BPE
-- tokens (via the jtokkit dependency), for fitting LLM context windows.
-- Follows the established V50__add_splittext_op.sql /
-- V51__add_extractheadings_op.sql drop/re-add pattern (PostgreSQL has no
-- ALTER CONSTRAINT for CHECK constraints).
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount'));

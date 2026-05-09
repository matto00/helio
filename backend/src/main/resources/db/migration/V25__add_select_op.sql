-- Extend the pipeline_steps op CHECK constraint to include 'select'.
-- PostgreSQL does not support ALTER CONSTRAINT for CHECK constraints;
-- the standard pattern is to drop and re-add with the new predicate.
-- The constraint was created inline in V23 and PostgreSQL auto-named it
-- pipeline_steps_op_check.
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select'));

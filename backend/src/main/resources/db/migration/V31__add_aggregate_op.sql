-- CS2c-3a: extend the pipeline_steps op CHECK constraint to include 'aggregate'.
--
-- The in-process engine has accepted 'aggregate' since the per-op series
-- landed, but the service-layer `AllowedOps` set was missing it (a latent bug
-- surfaced by CS2c-3a's sealed-trait dispatch over `PipelineStepKind.All`).
-- The DB CHECK constraint also predates 'aggregate'; this migration closes
-- the gap so 'aggregate' steps round-trip end to end.
--
-- PostgreSQL does not support ALTER CONSTRAINT for CHECK constraints;
-- the standard pattern is to drop and re-add with the new predicate.
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate'));

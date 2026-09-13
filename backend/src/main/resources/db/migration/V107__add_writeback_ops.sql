-- HEL-1104 (Migration B of the v0.8 write-back design): extend the pipeline_steps
-- op CHECK constraint to include the four write-back ops: 'upsertsource',
-- 'convertformat', 'analyzewithai', 'generatetext'.
--
-- This migration alone does not make the API accept steps using these ops —
-- PipelineAnalyzeService has no case for any of the four and falls through to
-- "Unknown op: '<op>'", and PipelineStepKind.All (the gate that actually
-- produces the route's 400) does not list them either. Each op's own ticket
-- (HEL-1099, 1105, 1106, 1107) wires product-level support; this migration
-- exists only so all four op tickets don't each need their own drop/re-add of
-- this constraint, which would collide across parallel lanes (see ticket).
--
-- Follows the established V50__add_splittext_op.sql / ... / V83__add_assert_op.sql
-- drop/re-add pattern (PostgreSQL has no ALTER CONSTRAINT for CHECK constraints).
-- The 23 existing ops below are copied verbatim from V83__add_assert_op.sql.
ALTER TABLE pipeline_steps
  DROP CONSTRAINT IF EXISTS pipeline_steps_op_check,
  ADD CONSTRAINT pipeline_steps_op_check
    CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast', 'select', 'limit', 'sort', 'aggregate', 'splittext', 'extractheadings', 'chunkbytokencount', 'datebucket', 'pivot', 'window', 'unpivot', 'dedupe', 'fillnull', 'stringops', 'union', 'lookup', 'assert', 'upsertsource', 'convertformat', 'analyzewithai', 'generatetext'));

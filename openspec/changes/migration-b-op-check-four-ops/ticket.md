# HEL-1104: Migration B: add all four new ops to `pipeline_steps_op_check` in one migration

## Description
One drop/re-add of `pipeline_steps_op_check` adding `upsertsource`, `convertformat`, `analyzewithai` and `generatetext` together, following the `V50`–`V83` pattern (PostgreSQL has no `ALTER CONSTRAINT` for CHECK constraints).

**One migration, one lane.** Parallel lanes each adding an op to this constraint collide — this is a known way to break `main`. Do not hardcode the V number.

**AC:** all four ops are accepted by the constraint after migration; the migration is owned by whichever of the two step epics lands first.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria
- One Flyway migration `V107__add_writeback_ops.sql` drops and re-adds `pipeline_steps_op_check`, adding `upsertsource`, `convertformat`, `analyzewithai`, `generatetext` to the existing 23-op list (rename, filter, join, compute, groupby, cast, select, limit, sort, aggregate, splittext, extractheadings, chunkbytokencount, datebucket, pivot, window, unpivot, dedupe, fillnull, stringops, union, lookup, assert) verbatim from V83__add_assert_op.sql — no op dropped, no typo introduced.
- Migration applies cleanly against a DB seeded with existing pipeline_steps rows using a representative sample of currently-allowed ops (a re-added CHECK constraint validates existing rows).
- Migration applies under the same non-superuser, non-BYPASSRLS role Flyway actually runs as in production (the `helio` role) — table ownership is required for a constraint drop/re-add; this must be proven, not assumed, given the V0.7.x RLS/role incident.
- This migration alone does not cause the API to accept pipeline steps using the four new ops: `PipelineAnalyzeService`'s op match has no case for `upsertsource`/`convertformat`/`analyzewithai`/`generatetext` and falls through to "Unknown op: '<op>'" — a test pins this rejection so a future op-wiring ticket flips it deliberately.
- No changes to `allowedOps`-style API/UI surfaces, StepCard, or apply/infer parity in this ticket — each op's own ticket wires product-level support.
- `schemas/` and `openspec/specs/` reflect the constraint change only if they currently enumerate op names (verified, not assumed).

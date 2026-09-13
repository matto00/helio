## Why

Four upcoming pipeline ops (`upsertsource`, `convertformat`, `analyzewithai`, `generatetext`)
each need `pipeline_steps_op_check` to accept their op string before their own epic can persist
a step. PostgreSQL has no `ALTER CONSTRAINT` for CHECK constraints, so each addition requires a
drop/re-add of the whole constraint (established `V50`-`V83` pattern). Landing all four in one
migration, in one lane, avoids two parallel lanes each re-adding the constraint and silently
clobbering the other's op.

## What Changes

- New Flyway migration `V107__add_writeback_ops.sql`: drops and re-adds `pipeline_steps_op_check`
  on `pipeline_steps`, adding `upsertsource`, `convertformat`, `analyzewithai`, `generatetext` to
  the existing 23-op allow-list (verbatim from `V83__add_assert_op.sql`).
- A regression test pinning that the API still rejects a pipeline step using any of these four
  ops with "Unknown op" — the DB now accepts the string, the product does not yet, and this
  boundary must not blur silently.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `pipeline-steps-persistence`: the `op` CHECK constraint's requirement text is stale (lists only
  13 of the current 23 ops, last updated at V52) and must be corrected to the full current list
  plus the four new ops added by V107, with a new scenario documenting that the four new op
  strings are DB-accepted but still rejected at the API (`PipelineStepKind.All`/`400`) until each
  op's own ticket registers it.

## Impact

- `backend/src/main/resources/db/migration/V107__add_writeback_ops.sql` (new)
- `backend/src/test/scala/...` — new/extended test proving Migration B is inert for product
  purposes until each op's own ticket lands
- Unblocks HEL-1099, HEL-1105, HEL-1106, HEL-1107 (each op's own step epic)

## Non-goals

- Wiring `upsertsource`/`convertformat`/`analyzewithai`/`generatetext` into
  `PipelineAnalyzeService`, apply/infer parity, `allowedOps`, or `StepCard` — each op's own
  ticket does this.

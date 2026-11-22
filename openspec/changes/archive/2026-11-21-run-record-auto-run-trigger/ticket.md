# HEL-1815: pipeline-run-record schema: triggerSource enum is missing "auto-run"

## Description

Follow-up from HEL-1812 (PR #1213, merged as afc2a6872); the owner chose a standalone ticket.

`schemas/pipelines/pipeline-run-record.schema.json` lists `triggerSource` values `manual`, `scheduled` and `external`.
The run-history route also returns `auto-run` (dataset-write auto-runs, HEL-1093). HEL-1812's e2e fix is the first
code that waits on that value.

## Do

- Add `auto-run` to the enum. Check every other place that lists trigger sources: other schemas, the generated or
  hand-written client types, the MCP types, and the UI labels for run history.
- Add a seam test that the real route's run record, including an `auto-run` one, validates against the schema.

## Acceptance criteria

- [ ] A test that fails on the current schema with an `auto-run` record.
- [ ] Clients and MCP handle `auto-run` with no unknown-value fallback, or the PR says why the fallback is acceptable.

## Why

`PipelineSchedulerServiceSpec.scala` (414 lines at f78b4c518) mixes two concerns under one `should` block: due-schedule
firing and the HEL-1272 output-history retention hook on the tick. It is hard to navigate and each new tick hook makes
it longer. HEL-1286 (follow-up of HEL-1272) asks for a concern-focused split with a shared fixture trait.

## What Changes

- Extract the shared embedded-Postgres fixture, fake clock, fake filesystem, DB cleanup and seed helpers into one
  small test-only trait in the same package.
- Keep schedule-firing tests in `PipelineSchedulerServiceSpec` (mixing in the trait).
- Move the retention-hook failure tests into a new `PipelineSchedulerServiceMaintenanceHooksSpec` (mixing in the trait).
- Test bodies, test names and assertions move verbatim; test count is unchanged (expected 11 before and after).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Pure test refactor; `.openspec.yaml` sets `skip_specs: true`.

## Impact

- `backend/src/test/scala/com/helio/services/pipelines/` only. No production code, schema, API or CI change.

## Non-goals

- No new tests or assertions (including no new product-event rollup hook test, even though the ticket text assumed one
  existed — that gap is a spinoff candidate, not this ticket's scope).
- No production-code changes; no fixing of bugs found during the move (noted as spinoffs).
- No touching `ci.yml`, `playwright.config.ts`, `.gitignore`.

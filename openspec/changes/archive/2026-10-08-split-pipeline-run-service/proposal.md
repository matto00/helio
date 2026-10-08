## Why

`PipelineRunService.scala` is 1770 lines at 4db9730fd, seven times CONTRIBUTING's ~250-line soft budget. It mixes run
submission and execution, the terminal persist-then-publish paths (HEL-1366/HEL-1370), node materialization and
history writes, Output backfill, and run-history reads. Recent correctness work (HEL-1366, HEL-1370, HEL-1374) had to
be reasoned about inside one file; splitting by concern makes each of those invariants reviewable in isolation.

## What Changes

- Move each concern's private implementation into its own `private[pipelines]` class in
  `com.helio.services.pipelines`: `PipelineRunTerminalWrites` (terminal persist-then-publish paths),
  `PipelineRunSucceededWrites` (the unblocked-success materialization chain), `PipelineRunExecutor` (submit-time
  execution and success dispatch), `PipelineRunBackfill`, `PipelineRunQueries`, and `PipelineRunSupport` (shared
  helpers). Bodies move verbatim.
- `PipelineRunService` keeps its name, package, constructor (every parameter, order and default), every public method
  signature, its companion object, `CachedRunStatus` and `TriggerSource`; it becomes the entry point that builds the
  collaborators and delegates. The two `ServiceError.Forbidden(` producers (submit, step preview) stay in this file.
- Update `services/pipelines/README.md` "Holds".

## Non-goals

- No behaviour change: identical SSE event order and timing relative to writes, identical errors, logs and logger
  name, identical test count; no test file edited.
- No caller changes (`ApiRoutes`, schedulers, hook/auto-run services, specs).
- No bug fixes, dead-code removal, comment rewrites or cleanup beyond moving code; findings become follow-ups.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — pure structural refactor (`skip_specs: true`).

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/` (one file split into seven; README).
- No API, schema, migration, frontend or helio-mcp impact.

## Why

`OutputRoutesSpec`'s HEL-947 negative test ("does not backfill ... never run") sleeps 200 ms and then asserts the Output is still `materialized=false`. The backfill it is guarding against runs fire-and-forget off the request path, and `OutputService` discards the `Future` that would say when it finished. So the test cannot tell "no backfill happened" from "the backfill has not happened yet": a regression that backfills unconditionally but slower than 200 ms passes green. No sleep length fixes that (HEL-1341 left this one site for exactly that reason).

## What Changes

- `OutputService` gains an optional, defaulted-no-op completion hook that receives the `Future[Unit]` of every fire-and-forget backfill it starts (create and update paths), keyed by the Output's id. Production wiring (`ApiRoutes`) passes nothing, so production behaviour is unchanged: the backfill is still not awaited by the HTTP response.
- `OutputRoutesSpec` registers a hook that records each backfill's Future per Output id. The negative test awaits the recorded Future for its Output (bounded give-up deadline) and only then asserts `materialized=false`. The `Thread.sleep(200)` is removed.
- A mutation proof is recorded: a deliberately broken `backfillOutputNode` that backfills a never-run node after a delay longer than the old sleep turns the new test red (and the old sleep-based test is shown green against the same mutation).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
None. No externally visible behaviour changes (route responses, timing, and backfill semantics are identical); `skip_specs: true`.

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` (new optional constructor parameter, `triggerBackfill` forwards the Future to it).
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` (fixture wiring + the negative test).
- No API, schema, migration, or frontend change.

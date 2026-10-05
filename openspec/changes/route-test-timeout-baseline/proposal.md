## Why

Pekko's route testkit fails a request that takes longer than its default 1s `RouteTestTimeout` ("Request was neither
completed nor rejected within 1 second"). 113 backend test classes mix the testkit in directly and only one sets an
explicit timeout, so any spec whose request does real DB or pipeline work races 1s on a loaded or cold machine.
FirstRunRoutesSpec's first test failed this way on attempt 1 of 19 CI runs between 2026-10-01 and 2026-10-05 (three
consecutive attempts on one PR), each time as the only failing test; local runs under load have hit other specs.

## What Changes

- One shared test base trait wraps Pekko's `ScalatestRouteTest` and supplies an explicit, generous, documented
  `RouteTestTimeout`. Every spec that mixes in the route testkit mixes in this trait instead, so new specs inherit it.
- A mechanical guard spec fails the backend suite when any test source mixes in `ScalatestRouteTest` directly.
- The first-request stall in FirstRunRoutesSpec is probed (cold one-time init vs. CPU contention). A cheap fixture
  warm-up is adopted only if the probe shows it removes the stall; the finding is documented either way.
- The one spec with its own 15s timeout (PublicRouteOwnerIdLeakSpec) drops the now-redundant local implicit.
- CONTRIBUTING.md's embedded-postgres test-group section names the base trait and the timeout's purpose.

## Capabilities

### New Capabilities
- `backend-route-test-harness`: the backend route-test harness's request-timeout contract — one shared, explicit
  timeout inherited by every route-testkit spec, a guard that keeps it that way, and the rule that the timeout bounds
  harness latency only and never stands in for a latency assertion.

### Modified Capabilities
(none)

## Impact

- `backend/src/test/scala/**` only: a new trait under `com.helio.testkit`, a guard spec, and a one-line mixin swap
  in each of the 113 classes that mix in `ScalatestRouteTest` today. No production code, no migration, no schema.
- `CONTRIBUTING.md` (backend testing guidance).

## Non-goals

- No change to production request handling or performance.
- No change to any spec's latency assertion (nanoTime/currentTimeMillis-based bounds stay exactly as they are).
- No change to the HEL-924 fork grouping/concurrency in `build.sbt`.
- Not a guarantee that CI never flakes for an unrelated reason; the proof's limits are reported.

# backend-route-test-harness Specification

## Purpose
Defines how long the backend's route-test harness waits for a request under test before failing it, so that test
results reflect correctness rather than machine load, and so that the wait never masquerades as a performance check.

## Requirements

### Requirement: Route-testkit specs inherit one explicit shared request timeout
Every backend test class that uses Pekko's route testkit SHALL obtain it through a single shared base trait, and that
trait SHALL supply an explicit `RouteTestTimeout` that is generous relative to the slowest first request any spec
makes under contention (and not the testkit's 1-second default). The value and its rationale SHALL be documented at
the trait.

#### Scenario: A slow-but-correct first request completes
- **WHEN** a route spec's first request applies and runs a pipeline against embedded Postgres on a CPU-contended
  machine and takes longer than 1 second but less than the shared timeout
- **THEN** the request's assertions run and the test passes or fails on its assertions, not on a harness timeout

#### Scenario: A new route spec inherits the timeout
- **WHEN** a new spec mixes in the shared base trait and declares no timeout of its own
- **THEN** its requests are bounded by the shared timeout, not by 1 second

#### Scenario: A genuinely hung request still fails
- **WHEN** a request under test never completes
- **THEN** the test fails with the testkit's timeout message once the shared timeout elapses

### Requirement: Direct use of the route testkit is rejected mechanically
The backend test suite SHALL fail when any test source other than the shared base trait mixes in `ScalatestRouteTest`
directly, naming each offending file.

#### Scenario: A spec bypasses the base trait
- **WHEN** a test class declares `with ScalatestRouteTest` (or `extends ScalatestRouteTest`) instead of the shared trait
- **THEN** the guard test fails and its message lists that file

#### Scenario: All specs use the base trait
- **WHEN** no test source other than the base trait mixes in `ScalatestRouteTest`
- **THEN** the guard test passes

### Requirement: The harness timeout is never a latency assertion
The shared timeout SHALL bound only how long the harness waits for a response. A spec that asserts latency SHALL do so
with its own explicit measurement and bound, and adopting the shared trait SHALL NOT change any such bound.

#### Scenario: A latency-asserting spec adopts the trait
- **WHEN** a spec that measures elapsed time and asserts a bound switches to the shared base trait
- **THEN** its measured bound and assertion are unchanged

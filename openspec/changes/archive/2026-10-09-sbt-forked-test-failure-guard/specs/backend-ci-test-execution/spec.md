## ADDED Requirements

### Requirement: A failing backend test always fails the sbt invocation
Any backend sbt test invocation (`testOnly`, `testFull`, `test`, through any launcher, thin client or server, locally
or in CI) in which at least one test fails or a suite aborts SHALL exit non-zero, even when sbt's own forked-test
result reporting loses that group's results. The failure output SHALL report the failed and aborted counts and point
to ScalaTest's per-suite output in the same log (the suite's header line followed by its `*** FAILED ***` test lines).
A whole-run abort inside a forked JVM that still exits zero SHALL fail the CI step; locally it is a documented
residual risk, not a guarantee.

#### Scenario: Lost forked-test events
- **WHEN** a forked test group's tests fail and sbt receives no result events for that group
- **THEN** the sbt invocation exits non-zero, its output reports the failed count, and the same log shows the failed
  suite's header line followed by its `*** FAILED ***` test lines

#### Scenario: Passing run is unaffected
- **WHEN** every selected test passes
- **THEN** the sbt invocation exits zero, and a failure recorded by an earlier invocation never fails a later one

#### Scenario: CI log carries a failure summary
- **WHEN** the CI sbt wrapper's sbt process exits zero but its log contains a ScalaTest failed or aborted summary or a
  run-aborted line
- **THEN** the CI step fails and names the reason

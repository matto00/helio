## Purpose

Defines how the backend test suite is executed in CI so that every test suite runs exactly once per pipeline, every
part of that execution gates merges, and a test is only ever removed with named surviving coverage.

## ADDED Requirements

### Requirement: Every backend test suite runs exactly once per CI pipeline
When the backend test suite is split across parallel CI shards, the assignment of test suites to shards SHALL be a
deterministic partition of the full set of discovered test suites: every suite assigned to exactly one shard. The
build SHALL verify this partition each time a shard runs and SHALL fail that shard, naming the offending suites, if
any suite is assigned to no shard or to more than one.

#### Scenario: A newly added spec is picked up without configuration
- **WHEN** a new test suite is added that no shard-balancing data mentions
- **THEN** it is assigned to exactly one shard and runs in CI

#### Scenario: A partition defect fails loudly
- **WHEN** the shard assignment would leave a discovered suite unassigned or assign it to two shards
- **THEN** the shard run fails before executing tests, and its output names each such suite

#### Scenario: Unsharded runs are unchanged
- **WHEN** the backend tests run with no shard selected (a local `sbt testFull`)
- **THEN** every discovered test suite runs, exactly as before this change

### Requirement: Every backend CI shard gates merges
The required CI aggregate check SHALL fail when any backend shard fails or is cancelled, and SHALL NOT succeed before
every backend shard has completed.

#### Scenario: One shard fails
- **WHEN** a single backend shard has a failing test while all other shards pass
- **THEN** the backend job's aggregate result is failure and the required aggregate check fails

### Requirement: A backend test is removed only with named surviving coverage
Removing a backend test for redundancy SHALL be recorded with the removed test's suite and name, the reason class
(duplicate, retired feature, or copy-pasted variant), and the suite and name of a test that still asserts the same
behaviour. A test SHALL NOT be removed or weakened to resolve flakiness.

#### Scenario: A removal without surviving coverage
- **WHEN** no remaining test can be named that asserts the removed test's behaviour
- **THEN** the test is not removed without an explicit driver or owner ruling

### Requirement: Backend CI timing is profiled from CI logs
The change that alters backend CI execution SHALL carry a profile, measured from CI run logs, giving per-phase
timings (setup, dependency resolution, compile, test-compile, test execution) and the 20 slowest test suites, both
before and after the change, together with the total test count before and after.

#### Scenario: The profile reconciles test counts
- **WHEN** the after-change profile reports per-shard test counts
- **THEN** their sum equals the before-change count minus the tests listed as removed, plus any tests added

### Requirement: Superseded pull-request CI runs are cancelled; main runs never are
The CI workflow SHALL cancel an in-progress or pending run for a pull request when a newer commit is pushed to that same
pull request, and SHALL NOT cancel, or leave pending behind another, any run triggered by a push to `main`.

#### Scenario: A new push supersedes a PR run
- **WHEN** a run for a pull request is in progress and a new commit is pushed to the same pull request
- **THEN** the older run is cancelled and the newer run proceeds

#### Scenario: Two pushes to main in quick succession
- **WHEN** two commits are pushed to `main` while the first commit's run is still in progress
- **THEN** both runs complete; neither is cancelled

### Requirement: Every CI job owned here has a bounded run time
The backend legs, `frontend`, `security` and `ci-complete` jobs SHALL each declare a job timeout of roughly two to three
times their measured typical duration, so a hung job fails instead of holding a runner until the platform default.

#### Scenario: A job hangs
- **WHEN** a step in one of these jobs stops making progress
- **THEN** the job is failed at its declared timeout and the required aggregate check fails

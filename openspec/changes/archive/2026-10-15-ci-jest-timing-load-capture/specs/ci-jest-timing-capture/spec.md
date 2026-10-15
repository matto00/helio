## Purpose

Records per-test durations and runner CPU/memory load for the frontend CI jest run, so an intermittent main-thread
stall on a CI runner can be located in a specific test and correlated with runner load after the fact.

## ADDED Requirements

### Requirement: Per-test timing is captured when opted in
When the timing-capture directory environment variable is set, each jest run (root and frontend) SHALL write one
record per test case to a newline-delimited JSON file in that directory, containing at least the test file path
relative to the repo root, the test's full name, its status, its duration in milliseconds and its wall-clock start and
end as epoch milliseconds, plus one header record identifying the run (suite label, start time). When the variable is
unset, the jest configuration SHALL be identical to the configuration without this capability.

#### Scenario: Capture enabled
- **WHEN** jest runs with the capture directory variable set to a writable directory
- **THEN** that directory contains an NDJSON file whose every line parses as JSON and that holds one record per
  executed test case, with a non-negative duration and start/end timestamps

#### Scenario: Capture disabled
- **WHEN** jest runs with the capture directory variable unset
- **THEN** no timing file is written and the resolved jest configuration (reporters included) is unchanged

#### Scenario: A stalled test is identifiable
- **WHEN** one test blocks the main thread synchronously for 1200 ms
- **THEN** that test's record has a duration of at least 1200 ms and the reader lists it among the slowest tests

### Requirement: Test semantics are unchanged
Enabling capture SHALL NOT change which tests run, their worker count, retries, timeouts, fake-timer behaviour or exit
status, and SHALL keep jest's existing reporter output in CI. A failure inside the capture reporter SHALL NOT turn a passing
test run into a failing one.

#### Scenario: Same outcome with capture on
- **WHEN** the same test files run with capture on and with capture off
- **THEN** the pass/fail counts and the process exit status are the same

### Requirement: Runner load is sampled during the CI jest run
The CI frontend job SHALL sample runner CPU utilisation (including steal and iowait), load average and memory
(available memory and swap use) at a fixed interval of about one second for the duration of its jest step, timestamped
in epoch milliseconds, and the sampler SHALL terminate on its own after a bounded duration shorter than the job's timeout even if never
stopped.

#### Scenario: Samples cover the test run
- **WHEN** the frontend job's jest step completes
- **THEN** the load file contains samples whose timestamps span the jest run's start to end

### Requirement: Capture is uploaded as a bounded artifact
The CI frontend job SHALL upload the timing and load files as one artifact whether the jest step passed or failed,
with an explicitly set retention period, and SHALL NOT add any third-party action or change workflow permissions.

#### Scenario: Failing run
- **WHEN** the jest step fails
- **THEN** the artifact is still uploaded and contains the timing records of the tests that ran

### Requirement: The artifact is readable in one command
A reader SHALL take the downloaded artifact directory and print the slowest test cases with their durations and the
load samples overlapping each, and the procedure SHALL be documented in CONTRIBUTING.md.

#### Scenario: Reading a downloaded artifact
- **WHEN** the reader is run against a downloaded artifact directory
- **THEN** it prints the slowest tests ordered by duration, each with the runner load during that test, and exits zero

# e2e-ci-sharding Specification

## Purpose
Defines how the end-to-end Playwright suite is split across parallel CI legs so that every discovered spec runs exactly
once and leg durations stay balanced against the CI time target.

## Requirements

### Requirement: Every discovered e2e spec runs in exactly one CI shard
The e2e CI legs SHALL partition the set of spec files that Playwright discovers under its own configuration (test
directory glob and `testIgnore`) so that each discovered spec file is assigned to exactly one leg. Each leg SHALL
verify the partition before running tests and SHALL fail, naming the offending spec files, if any discovered spec is
assigned to no leg or to more than one, or if the set of specs a leg is about to run differs from its assignment.

#### Scenario: A newly added spec is picked up without configuration
- **WHEN** a new e2e spec file is added that no weighting data mentions
- **THEN** it is assigned to exactly one leg and runs in CI

#### Scenario: A quarantined spec stays excluded
- **WHEN** a spec file matches a `testIgnore` entry in the Playwright configuration
- **THEN** no leg runs it

#### Scenario: A partition or selection defect fails loudly
- **WHEN** the assignment would leave a discovered spec unassigned or assign it twice, or a leg's effective test
  selection differs from its assigned spec files
- **THEN** the leg fails before executing tests, and its output names each such spec file

#### Scenario: An empty shard does not run the whole suite
- **WHEN** a leg is assigned no spec files
- **THEN** the leg runs no tests and never falls back to running the full suite

### Requirement: e2e shard assignment is weighted from CI evidence
Shard assignment SHALL be a deterministic function of the discovered spec files and a checked-in per-spec weight table
derived from CI Playwright reports (not local runs). Specs absent from the table SHALL receive a defined default
weight. The table SHALL be regenerable from CI artifacts by a documented command. When the regeneration is given the
current discovered test list, each test result in a report SHALL be weighted to a current spec file by its title path
(the describe chain plus the test title, excluding the file-level suite and the project) as follows: to the
file the report names if that file still contains a test with the same title path; otherwise to the one current file
that contains a test with that title path (a test moved by a split); otherwise to the file the report names if that
file is still discovered (a renamed test). A result whose title path is in several current files, none of them the
reported one, SHALL make the regeneration fail and name the test. A result that matches no current test and whose
file is no longer discovered SHALL be left out of the table and named on the regeneration's diagnostic output.

#### Scenario: Assignment is deterministic
- **WHEN** two legs of the same run compute the assignment from the same discovered specs and weight table
- **THEN** they compute the identical partition

#### Scenario: A split spec is weighted from the runs that measured it before the split
- **WHEN** a spec file is split into several files and the table is regenerated, with the current test list, from CI
  reports taken before the split
- **THEN** each new file's weight is the median across runs of the summed duration of the tests it now contains, and the old
  file has no row

#### Scenario: An ambiguous moved test fails the regeneration
- **WHEN** a report test's file no longer contains its title path and that title path is in more than one current file
- **THEN** the regeneration fails and names the test, rather than guessing or double-counting its duration

#### Scenario: Regeneration without the test list is unchanged
- **WHEN** the table is regenerated without the current test list
- **THEN** each result is weighted to the file its report names, exactly as before this change

### Requirement: e2e shard balance is measured in CI
A change to e2e shard assignment SHALL report, from at least five sequential CI runs measured through the GitHub API,
each leg's median and maximum duration (whole leg and test step), before and after the change, and the leg imbalance:
the slowest leg's median test-step duration minus the mean of all legs' median test-step durations. A run counts toward
any measured set only if every e2e leg succeeded and every leg's test report is present. The after imbalance SHALL be
at most 15 s and SHALL be lower than both the imbalance of the 25 most recent counting runs before the change and the
imbalance of a same-window control of at least five counting runs on other heads still using count-based sharding.

#### Scenario: Before/after report
- **WHEN** the change is delivered
- **THEN** its profile lists per-leg medians and maxima before and after, with the run ids measured

#### Scenario: Balance improves
- **WHEN** the after runs are compared with the before runs
- **THEN** the leg imbalance (slowest leg's median test step minus the mean of the legs' median test steps) is at most
  15 s and lower than both the 25-run before imbalance and the same-window control imbalance

> Delivery note (HEL-1361): measured after imbalance was 20.5 s. It meets the before-25 line (25.5 s) but misses
> <= 15 s and is not below the same-window control (20.0 s). The owner accepted the partial result on 2026-10-08;
> the remaining per-leg wall-time drift is HEL-1368 scope (see profile.md).

#### Scenario: An incomplete run is excluded
- **WHEN** a measured run has a leg that hung, was cancelled, failed, or produced no test report
- **THEN** the run is recorded with its logs but excluded from weight generation and from every measured set

### Requirement: e2e CI legs keep headroom under the job timeout
The e2e CI matrix SHALL have enough legs that, across 5 consecutive main-branch CI runs in which every e2e leg
succeeded, the slowest e2e leg's wall time (job `completedAt - startedAt` from the GitHub API) is at most 20 minutes.
The leg count is an owner decision recorded with the change that sets it; the job `timeout-minutes` SHALL NOT be raised
to meet this requirement.

#### Scenario: Headroom measured on main
- **WHEN** 5 consecutive all-green main runs complete after a change to the leg count
- **THEN** the slowest e2e leg in each of them is at most 20 minutes, reported as a before/after table with run ids

#### Scenario: A leg slower than 20 minutes
- **WHEN** any of those runs has an e2e leg slower than 20 minutes
- **THEN** the requirement is reported as not met with the measured table, and the leg count or per-leg cost is
  revisited rather than the timeout raised

### Requirement: Each e2e CI leg records the runner it ran on
Each e2e CI leg SHALL record, as an artifact separate from its test report, the runner's CPU model, vCPU count and total
memory, and a sample of the runner's load at least once per second while the suite runs (CPU busy, steal and iowait
percentages and run queue), from the start of the job's setup to the end of the suite. The record SHALL never fail a
leg, its sampler SHALL be started before setup with a fixed self-stop bound shorter than the job limit (so it exits
before the job limit even if never stopped), and its artifact
name SHALL NOT match the name pattern of the per-leg test reports used to regenerate shard weights. The record SHALL NOT
include environment variables or secrets.

#### Scenario: A slow leg can be attributed
- **WHEN** one e2e leg of a run is markedly slower than the others
- **THEN** that leg's artifact shows its CPU model and its load and steal over the suite, so the slowdown can be compared
  with the runner of every other leg of the run

#### Scenario: The record cannot fail or extend a leg
- **WHEN** the runner record step or the load sampler fails or is not stopped
- **THEN** the leg's result is decided by the test suite alone, and the sampler, started before setup with a self-stop
  bound shorter than the job limit, exits by itself before that limit

#### Scenario: Weight regeneration is unaffected
- **WHEN** the shard weights are regenerated from a run's artifacts
- **THEN** the runner records are not read as test reports, and each leg still has exactly one test report

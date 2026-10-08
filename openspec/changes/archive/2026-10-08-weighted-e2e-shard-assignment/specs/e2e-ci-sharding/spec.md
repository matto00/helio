## Purpose

Defines how the end-to-end Playwright suite is split across parallel CI legs so that every discovered spec runs exactly
once and leg durations stay balanced against the CI time target.

## ADDED Requirements

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
weight. The table SHALL be regenerable from CI artifacts by a documented command.

#### Scenario: Assignment is deterministic
- **WHEN** two legs of the same run compute the assignment from the same discovered specs and weight table
- **THEN** they compute the identical partition

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

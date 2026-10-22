## ADDED Requirements

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

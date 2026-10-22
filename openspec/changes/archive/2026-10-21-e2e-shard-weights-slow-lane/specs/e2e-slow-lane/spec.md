## Purpose

Keeps the e2e sweeps that PR CI skips behind `HELIO_E2E_SLOW=1` running in CI on a schedule, so a regression in them
is caught after merge instead of only by a developer's local pre-merge run.

## ADDED Requirements

### Requirement: Slow-gated e2e sweeps run on a weekly schedule
A CI workflow SHALL run the e2e spec files that contain `HELIO_E2E_SLOW`-gated tests (`hel1582-sweep-390` and
`hel1582-sweep-768`) with `HELIO_E2E_SLOW=1` against a real backend, database and dev server, on a weekly schedule on
the default branch, and SHALL also be runnable on demand. It SHALL NOT run on every pull request or push.

#### Scenario: Weekly run
- **WHEN** the weekly schedule fires
- **THEN** the workflow runs the two sweep spec files on the default branch with `HELIO_E2E_SLOW=1`

#### Scenario: Manual run
- **WHEN** a maintainer dispatches the workflow manually
- **THEN** it runs the same sweeps on the chosen ref

#### Scenario: Ordinary pull requests do not run it
- **WHEN** a pull request changes neither the slow-lane workflow file nor anything it is filtered on
- **THEN** the slow lane does not run

### Requirement: The slow lane fails when the gated tests did not run
The slow lane SHALL fail if any test in its selection was skipped or if it ran zero tests, so that a broken or renamed
`HELIO_E2E_SLOW` gate cannot produce a green run that exercised nothing.

#### Scenario: Gate not honoured
- **WHEN** the MAXIMAL sweeps are skipped (for example the environment variable did not reach the test process)
- **THEN** the slow-lane job fails and names the skipped tests

#### Scenario: All gated tests ran and passed
- **WHEN** every selected test ran and passed
- **THEN** the job succeeds

## MODIFIED Requirements

### Requirement: Every CI job is required by ci-complete
A static check SHALL fail whenever any job defined in `.github/workflows/ci.yml`, other than `ci-complete` itself, is
absent from `ci-complete`'s `needs` list, naming each missing job. The check SHALL run both in the pre-commit hook and
inside the `ci-complete` job itself, so that removing any job (including the job that previously hosted the check) from
`needs` turns the required `ci-complete` check red in CI.

#### Scenario: A job left out of needs
- **WHEN** `ci.yml` defines a job that is not listed in `ci-complete`'s `needs`
- **THEN** the check exits non-zero and names that job

#### Scenario: Every job listed
- **WHEN** every job other than `ci-complete` is listed in `ci-complete`'s `needs` and a `ci-complete` step runs the guard
- **THEN** the check exits zero

#### Scenario: The frontend job dropped from needs
- **WHEN** `frontend` is removed from `ci-complete`'s `needs`
- **THEN** the check, run by a step of the `ci-complete` job, exits non-zero naming `frontend`

## ADDED Requirements

### Requirement: The guard anchors itself in ci-complete
The check SHALL fail when no step of the `ci-complete` job runs it (`npm run check:ci-complete-needs` or
`node scripts/check-ci-complete-needs.mjs`, matched as exact tokens), so the CI run of the guard cannot silently move out of the required job.

#### Scenario: Guard step removed from ci-complete
- **WHEN** `ci-complete`'s steps no longer run the guard
- **THEN** the check exits non-zero saying `ci-complete` must run it

#### Scenario: Only the selftest runs in ci-complete
- **WHEN** `ci-complete`'s only related step runs `npm run check:ci-complete-needs:selftest`
- **THEN** the check exits non-zero saying `ci-complete` must run the guard

## ADDED Requirements

### Requirement: The hygiene guard's self-test is enforced in continuous integration

The `check-openspec-hygiene` self-test SHALL run as a merge-blocking continuous-integration step, in addition to
the pre-commit chain. A pre-commit hook alone SHALL NOT be treated as sufficient enforcement for the self-test,
because the hook chain is bypassable and does not run on changes that reach the default branch by another route,
leaving the evidence that the hygiene guard is capable of failing unexercised by any merge-blocking run.

#### Scenario: The self-test runs on every pull request

- **WHEN** continuous integration runs on a pull request
- **THEN** it runs the hygiene guard's self-test, so a guard silently degraded into checking nothing is caught by
  a run that cannot be bypassed

#### Scenario: A bypassed hook does not evade the self-test

- **WHEN** a change that breaks the hygiene guard's own checks is committed with the pre-commit hook bypassed and
  pushed as a pull request
- **THEN** the continuous-integration run fails, blocking the merge

## MODIFIED Requirements

### Requirement: The gate is enforced where it cannot be skipped

The gate and its self-test SHALL run as merge-blocking continuous-integration steps, in addition to any local
pre-commit hook. A local hook alone SHALL NOT be treated as sufficient enforcement, because the hook chain is
bypassable and because the repository's hook-invoked test step is vacuous inside the linked worktrees where
delivery runs execute.

The self-test SHALL NOT report success when any of its cases was skipped during a continuous-integration run. Its
permission-denial cases cannot execute as euid 0, because a `chmod 000` fixture does not restrict root; when the
self-test detects that it has skipped cases while running in continuous integration, it SHALL exit non-zero and
name the skipped cases, rather than exiting zero with a skip notice. Outside continuous integration the same
condition SHALL remain a visible non-fatal notice, so that a developer running as root is warned rather than
blocked. Enforcement SHALL NOT depend on the runner image happening to execute as a non-root user.

#### Scenario: A commit bypasses the local hook

- **WHEN** a change carrying a credential-shaped string is committed with the pre-commit hook bypassed and pushed
  as a pull request
- **THEN** the continuous-integration run fails, blocking the merge

#### Scenario: The self-test is enforced alongside the gate

- **WHEN** continuous integration runs
- **THEN** it runs both the gate and the gate's self-test, so a gate silently degraded into examining nothing is
  caught by the same merge-blocking run

#### Scenario: A root continuous-integration runner fails rather than skipping

- **WHEN** the self-test runs in continuous integration as euid 0, so its permission-denial cases cannot be
  exercised
- **THEN** it exits non-zero and names the skipped cases, so the coverage loss blocks the merge instead of
  reporting success

#### Scenario: A local root run is warned, not blocked

- **WHEN** the self-test runs as euid 0 outside continuous integration and skips its permission-denial cases
- **THEN** it exits zero but names the skipped cases, so the developer sees the reduced coverage

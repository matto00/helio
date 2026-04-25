# sbt-worktree-isolation Specification

## Purpose
TBD - created by archiving change parallel-orchestrator-port-isolation. Update Purpose after archive.
## Requirements
### Requirement: sbt Ivy cache is scoped to the worktree
The backend sbt project SHALL configure the Ivy home directory to a path local to the project (`.ivy2/`
relative to the sbt base directory) so that parallel sbt invocations in separate git worktrees do not
share the global `~/.ivy2` lock. The `target/` directory is already per-project and requires no change.

#### Scenario: Parallel sbt test runs complete without deadlock
- **WHEN** two separate worktrees each invoke `sbt test` simultaneously
- **THEN** both runs complete independently without lock contention or deadlock

#### Scenario: Single sbt run unaffected
- **WHEN** one worktree invokes `sbt test` with no other sbt process running
- **THEN** the run completes normally with the same outcome as before this change

#### Scenario: Ivy artifacts stored in worktree-local path
- **WHEN** `sbt test` is run in a worktree for the first time
- **THEN** Ivy artifacts are downloaded to `<worktree>/backend/.ivy2/` rather than `~/.ivy2/`


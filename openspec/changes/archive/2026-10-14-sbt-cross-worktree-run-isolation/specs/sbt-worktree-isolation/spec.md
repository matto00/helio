## ADDED Requirements

### Requirement: A local testFull runs the invoking worktree's own build
A `sbt testFull` invoked from a worktree's `backend/` directory SHALL load that worktree's build definition and SHALL
execute tests compiled from that worktree's own sources, even when another worktree at different code shares the
same machine, the same user-level sbt disk cache, and has run (or is running) sbt. Its `loading project definition`
and `set current project` lines SHALL name the invoking worktree. Results produced by another worktree's build SHALL
never be reported as this worktree's results.

#### Scenario: A failing test in tree A still fails after tree B ran green
- **WHEN** tree B (identical build, all tests passing) runs `sbt testFull` green, and then tree A (the same build
  plus one deliberately failing test) runs `sbt testFull` against the same shared sbt disk cache
- **THEN** tree A's run executes the failing test, reports it failed, and exits non-zero

#### Scenario: Another tree's live sbt server does not serve tree A's run
- **WHEN** tree B has a live sbt server and tree A runs `sbt testFull` (or `sbt "testOnly <spec>"`) either bare or as
  `sbt -batch -Dsbt.server.autostart=false ...`, from tree A's `backend/`
- **THEN** tree A's project-path lines name tree A and its failing test is reported as failed

#### Scenario: Thin-client runs are not test evidence unless proven isolated
- **WHEN** a run uses `sbt --client` and another tree's server is live
- **THEN** either it is proven to connect only to tree A's own server, or MISTAKES.md states that `--client` runs are
  never cited as test evidence

#### Scenario: A concurrent run in tree B does not leak into tree A
- **WHEN** tree A's cold run starts while tree B's run against the same shared disk cache is in progress
- **THEN** tree A's project-path lines name tree A and its failing test is reported as failed

#### Scenario: A lane can check that a cited run is its own
- **WHEN** a lane cites a local `testFull` transcript as evidence
- **THEN** MISTAKES.md documents the exact check (which lines must name the lane's own worktree, and which counts
  show tests executed) that distinguishes the lane's own run from another tree's output

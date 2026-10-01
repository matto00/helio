# HEL-1226: Local/agent `sbt test` gates can be cache-served no-ops on sbt 2; switch to `sbt testFull`

## Description

sbt 2 (adopted in HEL-1018, PR #724) caches `test` results: a repeat bare `sbt test` with no source change prints "No tests to run for Test / testQuick ... cache 100%" and exits 0 -- a vacuous green. CI is fixed (`sbt "compile; testFull"`, MISTAKES.md entry added), but bare `sbt test` remains in: CLAUDE.md, CONTRIBUTING.md, docs/cloud-dev-setup.md, and in the rendered concertino gate commands (`concertino.config.json` gates `sbt test`, flowing into .claude/agents/* and .cursor/skills/*; those are render targets: change concertino.config.json / upstream concertino, then `concertino sync`).

## Acceptance Criteria

- Every documented/agent gate that means "run the full backend suite" uses `testFull` (or equivalent).
- Verify a repeat run actually executes tests (red on main: repeat `sbt test` runs zero tests; green: the new gate command runs the full suite on a repeat run).

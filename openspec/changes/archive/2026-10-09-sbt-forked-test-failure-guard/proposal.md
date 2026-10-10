## Why

sbt 2.0.9 can lose a forked test group's result events (see ticket.md, Planning findings): ScalaTest prints
`*** N TESTS FAILED ***`, sbt prints `No tests to run` and `[success]`, and exits 0. Reproduced in 4 of 6 runs of a
40-failure spec. Every gate that trusts the sbt exit code (lane evaluators, red-first proofs, CI's `testFull`) can
certify a red run as green. The defect is in sbt (`ForkTests`), unfixed upstream through v2.0.10.

## What Changes

- The build checks ScalaTest's own run summary (which arrives over a channel independent of the lost events) after
  every sbt test task and fails the task when it reports failed or aborted tests -- on `testOnly`, `testFull`, `test`,
  any launcher, client or server. Fail closed if the summary cannot be read.
- `scripts/ci-sbt.sh` additionally fails a run whose sbt log carries a ScalaTest failure/abort summary while sbt exited
  0, and on `*** RUN ABORTED ***` (a log scan on the merge gate; it reads the same ScalaTest
  summary, so it is independent of the build wiring, not of ScalaTest's channel).
- MISTAKES.md entry for the trap, the guard, and how to verify a backend test run.
- A concertino (CON) ticket for lane guidance: judge sbt runs by the ScalaTest summary lines as well as the exit code.

## Capabilities

### New Capabilities

### Modified Capabilities
- `backend-ci-test-execution`: adds the requirement that a failing or aborted backend test always makes the sbt
  invocation exit non-zero, locally and in CI.

## Impact

- `backend/build.sbt`, a new `backend/project/*.scala` helper, a unit spec.
- `scripts/ci-sbt.sh` and `scripts/ci-sbt.selftest.mjs` (also touched by the concurrent HEL-1425 lane; the later
  merger reconciles).
- `MISTAKES.md`. No production code, no runtime, no schema change.

## Non-goals

- Fixing sbt itself (an upstream report is a follow-up), upgrading sbt, or un-forking tests.
- The separate cross-worktree server attach hazard (existing MISTAKES entry) beyond recording what the probe matrix
  observed.
- Any `.husky/**` change.

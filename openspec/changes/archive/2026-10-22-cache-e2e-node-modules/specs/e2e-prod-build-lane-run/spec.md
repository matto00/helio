## Purpose
Lets a concertino lane run the `@prod-build` e2e tests (`npm run e2e:prod-build`) end to end with documented scripts
only, starting and stopping a backend alone without hand-built commands or unsafe process handling.

## ADDED Requirements

### Requirement: A lane can start the backend alone for the lane's ports
`scripts/e2e-backend.sh lane-start`, run with the lane's `DEV_PORT` and `BACKEND_PORT` exported, SHALL start the
backend listening on `BACKEND_PORT` with CORS allowing `http://localhost:$DEV_PORT`, SHALL wait until
`http://localhost:$BACKEND_PORT/health` answers (failing fast as `wait` does), and SHALL keep its log and process-group
files in the worktree's git admin dir. It SHALL refuse to start when either variable is unset, when `BACKEND_PORT`
already answers, or when a `backend.pid` record for a live process already exists. The `start` and `wait`
subcommands used by CI SHALL be unchanged and SHALL never write a `backend.pid` record.

#### Scenario: lane start
- **WHEN** a lane with DEV_PORT=7131 and BACKEND_PORT=10038 runs `e2e-backend.sh lane-start`
- **THEN** it reports healthy against port 10038, and the backend log names `http://localhost:7131` as a CORS allowed
  origin

#### Scenario: live record is not overwritten
- **WHEN** `concertino-servers/backend.pid` names a live process and `lane-start` runs
- **THEN** it exits non-zero naming that file and pid, and the file is unchanged

#### Scenario: CI start unchanged
- **WHEN** `e2e-backend.sh start` runs (CI, or the local `selftest:ci-sbt` harness)
- **THEN** it behaves exactly as before this change and writes no `concertino-servers/backend.pid`

### Requirement: The lane backend stops through stop-servers.sh
A backend started by `e2e-backend.sh lane-start` SHALL be stoppable by
`scripts/concertino/stop-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>` alone, leaving no process of its
process group alive and the port free. No new stop path SHALL signal by name pattern or signal a parent process.

#### Scenario: stop after a run
- **WHEN** `stop-servers.sh` runs after a lane backend started this way
- **THEN** it prints `STOPPED`, `BACKEND_PORT` is free, and no process of the recorded process group remains

### Requirement: The in-lane prod-build sequence is documented
`e2e/README.md` SHALL document the in-lane sequence: stop the lane's servers with `stop-servers.sh`, start and wait
for the backend with `e2e-backend.sh lane-start`, run `npm run e2e:prod-build` with the lane's `DEV_PORT`/`BACKEND_PORT`, stop with `stop-servers.sh`,
and restart ordinary lane servers with `start-servers.sh`. Following it verbatim in a lane SHALL run the `prod-build-guard` and `prod-build` projects to
completion.

#### Scenario: documented run
- **WHEN** a lane follows the README sequence verbatim
- **THEN** `npm run e2e:prod-build` exits with Playwright's status after running the guard and every `@prod-build`
  test, without any command absent from the README

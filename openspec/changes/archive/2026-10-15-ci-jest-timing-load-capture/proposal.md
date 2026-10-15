## Why

HEL-1596 fixed one flaky test, but the ~1 s main-thread stall that made the CI runner miss a findBy deadline is still
unexplained (91 s local suite vs 219 s on the failing CI run). The next failing frontend CI run has to carry the data
that shows whether a stall happens, in which test, and what the runner's CPU/memory looked like at that moment.

## What Changes

- An opt-in jest reporter (enabled only when a capture directory env var is set) writes one compact record per test
  case: file, full name, status, duration and wall-clock start/end, to an NDJSON file. Both jest configs (root and
  frontend) use the same shared helper, so `npm test` keeps its command line.
- A small, self-terminating load sampler records runner CPU (user/system/iowait/steal/idle), load average and memory
  (available, swap) once per second, with epoch-ms timestamps on the same clock as the reporter.
- The CI `frontend` job starts the sampler before `npm test`, sets the env var on that step, stops the sampler by its
  recorded PID, and uploads the files as one artifact (`if: always()`, explicit `retention-days`), with a short
  slowest-tests / peak-load summary in the job's step summary.
- A reader script prints the slowest tests and the load samples overlapping each, so the artifact can be read in one
  command; documented in CONTRIBUTING.md.

## Capabilities

### New Capabilities
- `ci-jest-timing-capture`: per-test timing and runner-load capture for the frontend CI jest run.

### Modified Capabilities

## Non-goals

- Fixing the stall itself, or changing any test, worker count, retry, timeout or `CI=true` resource value.
- In-worker event-loop-lag instrumentation (it would add timers inside the test environment and could interact with
  fake timers, changing test semantics).
- Capturing timing for the e2e (Playwright) or backend jobs.

## Impact

`.github/workflows/ci.yml` (`frontend` job only), `jest.config.cjs`, `frontend/jest.config.cjs`, new files under
`scripts/` and `scripts/lib/`, root jest unit tests for them, `CONTRIBUTING.md`. Uses only `actions/upload-artifact`,
already used in ci.yml. No permissions change. Local runs unchanged unless the env var is set explicitly.

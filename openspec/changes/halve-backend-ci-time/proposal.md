## Why

The CI `backend` job is the critical path of every PR and every `main` push: 12m39s on the first run after #769
(17–18.5 min before it), of which ~10.5 min is ScalaTest execution of 5954 tests. HEL-1287 sets an absolute target of
a ≤ 5.5 min job median on `main`, without losing coverage.

## What Changes

- Commit a **profile artefact** (`profile.md` in this change) splitting the backend job into setup, dependency
  resolution, compile, test-compile and test execution, ranking the top 20 slowest specs, and estimating per-spec
  embedded-Postgres/Flyway setup versus assertion time — before and after.
- **Remove redundant/unnecessary tests** only where a named surviving test covers the same behaviour, recorded in a
  removal ledger (`removed-tests.md` in this change).
- **Optimise the long-running specs** the profile identifies (fixed sleeps, long waits, oversized fixtures, repeated
  per-spec DB setup), each with a measured before/after.
- **Shard the backend CI job** into N parallel matrix legs over a deterministic, balanced partition of test suites,
  with a build-time guard that fails if any suite is assigned to zero or more than one shard. `ci-complete` continues
  to gate on every leg.
- Keep the sbt dependency-cache key identical to `main`'s; cache compile output, restored on every run and saved only
  by a push to `main` from shard 0 (one entry per key, none per PR or per leg).
- (Owner scope addition) A workflow-level concurrency group that cancels superseded PR runs but never `main` runs,
  explicit `max-parallel` on the backend matrix, and `timeout-minutes` of ~2–3x measured duration on the backend legs,
  `frontend`, `security` and `ci-complete`.
- Update `MISTAKES.md`'s "backend CI job takes ~12 minutes" entry to the measured result.

## Capabilities

### New Capabilities
- `backend-ci-test-execution`: how the backend test suite is executed in CI — complete, exactly-once coverage of
  every test suite across shards, gating, and how a test may be removed.

### Modified Capabilities
<!-- none: backend-route-test-harness requirements (HEL-1228) are preserved unchanged -->

## Non-goals

- No change to `backend/.sbtopts`, local developer defaults for test grouping/concurrency, or the HEL-1228 route
  timeout and its guard.
- No change to the e2e job (HEL-1288 owns it); no change to `frontend` or `security` beyond job-level `timeout-minutes`.
- No test removed or weakened to fix a flake; no coverage traded for time.
- Not migrating test infra to a different DB strategy wholesale (e.g. Testcontainers).

## Impact

- `.github/workflows/ci.yml`: the backend job, the workflow-level `concurrency:` stanza, and job-level `timeout-minutes` on
  `frontend`/`security`/`ci-complete`.
- `backend/build.sbt` test grouping / sharding; possibly `backend/project/*.scala` and a committed suite-weight file.
- Selected `backend/src/test/**` specs and test-support harnesses.
- `MISTAKES.md`; possibly `.gitignore` (HEL-1292, conditional).

## Context

See proposal.md - Why. Current state (main at c1b2e8091):
- `.github/workflows/ci.yml` job `frontend` runs `- run: npm test` (root script `jest && npm --prefix frontend test`)
  with no timing output and no load sampling. `check:precommit-ci-parity` requires that literal `npm test` run step to
  stay (the hook runs `npm test`).
- `jest.config.cjs` and `frontend/jest.config.cjs` both spread `localJestCaps()` from `scripts/lib/jest-local-caps.cjs`,
  which returns `{}` under `CI` (HEL-1442) so CI keeps jest's default worker count.
- Jest 30.3: `reporters` unset means `[detectAgent() ? 'agent' : 'default']` (`@jest/core` `_setupReporters`); there is
  no implicit `github-actions` reporter. `TestCaseResult` carries `duration` and `startedAt` (epoch ms, set in the
  worker); `TestResult.perfStats` carries file-level `start`/`end`/`runtime`/`setupFilesEnd`.
- `actions/upload-artifact` (v4 and v7) is already used in ci.yml with `retention-days: 14`/`7`.

## Goals / Non-Goals

**Goals:** per-test-case and per-file wall-clock timing plus 1 Hz runner load, on the same clock, from every frontend CI
run, in an artifact that survives a failing run; one command to read it.

**Non-Goals:** in-worker event-loop-lag probes (timers inside the test env can interact with fake timers);
e2e/backend jobs; any change to worker count, retries, timeouts or `CI=true` values.

## Decisions

1. **Opt-in by env var, not by `CI`.** A shared helper `scripts/lib/jest-timing-capture.cjs` exports
   `timingReporters(label, rootDir, env)` returning `{}` when `HELIO_JEST_TIMING_DIR` is unset, else
   `{ reporters: ["default", [<abs path to reporter>, { dir, label, repoRoot }]] }`. Both jest configs spread it (labels
   `root` and `frontend`). Only the workflow sets the variable, so local runs (and CI=true local runs) are unchanged, and
   a developer can still opt in locally with the local caps in force (this is how the executor verifies it).
   `"default"` is listed explicitly because a set `reporters` replaces the implicit default; `agent` detection is
   irrelevant in CI. Alternative rejected: `jest --json --outputFile` - root `npm test` cannot forward CLI flags to the
   nested `npm --prefix frontend test`, it gives no per-test start time, and it writes nothing if jest is killed.

2. **Reporter writes NDJSON incrementally.** `scripts/lib/jest-timing-reporter.cjs` appends one line per event with
   `fs.appendFileSync` to `<dir>/jest-timing-<label>.ndjson`: a `run` header (label, startedAt, pid), one `case`
   record per `onTestCaseResult` (`file` relative to repo root, `name` = fullName, `status`, `duration`, `start` =
   `startedAt`, `end` = start+duration, falling back to arrival time when `startedAt` is null and marking `approx:true`),
   one `file` record per `onTestFileResult` (perfStats start/end/runtime/setupFilesEnd, counts), and a `done` record on
   `onRunComplete`. Incremental append means a job killed by `timeout-minutes` still leaves data. Every write is in a
   try/catch that logs one warning and disables the reporter; it never throws and never implements `getLastError`, so a
   reporter fault cannot fail a green run (spec: Test semantics are unchanged). No failure messages are recorded (size).

3. **Load sampler is a dependency-free CommonJS node script.** `scripts/ci-load-sampler.cjs <out.ndjson> <maxSeconds>` writes one
   line per second: `t` (epoch ms), CPU percentages since the previous sample from `/proc/stat` (`user`, `system`,
   `iowait`, `steal`, `idle`), `procsRunning`, `/proc/loadavg` 1-min, `/proc/meminfo` `MemAvailable` and swap used (MB).
   It exits on its own after `maxSeconds` (1080 s = 18 min, below the job's `timeout-minutes: 20`, and far above the
   measured 219 s worst `npm test` step) and on SIGTERM. Parsing is pure exported functions (`module.exports`, guarded
   by `require.main === module` for the CLI) so it is unit-tested against fixture text. A bash `while` loop was rejected: harder to test, and
   computing CPU deltas in bash is error-prone.

4. **Workflow wiring (frontend job only), steps around the unchanged `- run: npm test`:**
   - before it: `Start runner load sampler` - `mkdir -p "$RUNNER_TEMP/jest-timing"`, start the sampler with `nohup ... &`
     and write `$!` to a pid file (same pattern as the e2e job's vite start);
   - the `npm test` step gains only `env: HELIO_JEST_TIMING_DIR: ${{ runner.temp }}/jest-timing` (`run:` text unchanged,
     so the parity check and `check:ci-complete-needs` see the same command);
   - after it, all `if: always()`: `Stop runner load sampler` (`kill` the recorded PID only, never a name lookup, then
     `continue-on-error: true`), `Summarize jest timing` (reader `--markdown` appended to `$GITHUB_STEP_SUMMARY`,
     `continue-on-error: true` so a reader bug can never fail the job), and `actions/upload-artifact@v7` with
     `name: jest-timing-${{ github.run_attempt }}`, the directory as `path`, `if-no-files-found: warn`,
     `retention-days: 14` (matches the existing evidence artifacts in ci.yml: long enough to look at a flake found a
     few days later, short enough to bound storage).
   Upload always, not failure-only: a passing run's file is the baseline that tells a 1 s stall apart from a normally
   slow test, and the files are small (measured, task 4). No new action, no `permissions` change.

5. **Reader.** `scripts/jest-timing-report.cjs <dir> [--top N] [--markdown]` reads every `jest-timing-*.ndjson` and
   `load.ndjson`, prints the top N (default 15) cases by duration with file, name, duration, start offset, and the
   max steal/iowait/user+system and min MemAvailable of the load samples overlapping `[start,end]`, plus run-level peaks.
   Malformed lines are counted and reported, not fatal. Pure functions exported for unit tests.

6. **Tests: CommonJS modules, `*.test.js` files, root jest.** Root testMatch is `**/?(*.)+(spec|test).[tj]s?(x)`
   (jest.config.cjs:6): it collects `*.test.js` but never `*.test.mjs`/`*.test.cjs`, and root jest cannot load `.mjs`
   (no `--experimental-vm-modules`, skeptic-design-1 probe). So every new module is `.cjs` (as
   `scripts/lib/jest-local-caps.cjs`) and tested from `*.test.js` next to it (as `scripts/lib/jest-local-caps.test.js`):
   reporter (synthetic events -> file content, disabled-on-error), helper (`{}` when unset; never emits `'agent'`, which
   root jest 30.2 does not have), sampler parsers (fixture `/proc` text), reader (fixture directory -> slow test listed
   with overlapping load). Proof of collection is required: the run output must list each new test file with non-zero
   test counts (`--listTests` plus the run's per-file lines). No change to any existing test.

## Risks / Trade-offs

- [Explicit `reporters` drops jest's implicit default reporter choice] -> `"default"` listed first; executor proves with
  `CI=true jest --showConfig` diffs (env set vs unset) that only `reporters` differs, for both configs.
- [Sampler competes for CPU] -> 1 Hz reads of three small /proc files; negligible. Measured via job duration delta.
- [Artifact storage on every PR] -> compact records, no messages; size measured on the PR run and reported.
- [`startedAt` absent on some results] -> fallback to arrival time, flagged `approx`.
- [Stall outside a test case (module load, setup)] -> file records carry perfStats; the reader's file view shows it.

## Migration Plan

Additive. Rollback = revert the commit; nothing persists beyond the artifacts' 14-day retention.

## Proof plan (on the PR's own CI, after the PR exists)

1. First PR run: download the artifact (`gh run download`), run the reader, record artifact size (`gh api` artifact
   `size_in_bytes`) and the frontend job / `npm test` step durations against the last 3 main runs.
2. Scratch commit adding a 1200 ms synchronous busy-wait to one existing frontend test, push, confirm the reader lists
   that test with duration >= 1200 ms; then a revert commit, push, and CI green on the reverted head before merge.

## Planner Notes

- Revised after skeptic-design-1 (REFUTE): .cjs modules + `*.test.js`; sampler bound 1080 s. Executor runs `npm ci` at
  the worktree root first (no root node_modules there) rather than letting `npx` fetch a jest. The injected 1200 ms
  stall must be a test without fake timers (a `Date.now` busy-wait never ends under fake timers) or use `Atomics.wait`.
- Opting in locally inside an agent session swaps the frontend's `agent` reporter for `default`; the "keeps existing
  reporter output" requirement is about CI, where `agent` is not detected.

- Self-approved: retention 14 days (existing ci.yml precedent); upload always rather than failure-only; env-var opt-in.
- Not touched: `.husky/**`, worker counts, `scripts/lib/jest-local-caps.cjs`, e2e job (HEL-1613 lane), scala-quality
  script (HEL-1603 lane).

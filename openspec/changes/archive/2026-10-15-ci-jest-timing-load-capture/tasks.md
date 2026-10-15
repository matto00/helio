## Standing Constraints

- [C1] Every new test file must be proven collected and run (file listed in the jest run with non-zero test counts from this worktree's paths); a green suite that never collected the new tests is not evidence.

## 1. CI capture tooling

- [x] 1.0 Run `npm ci` at the worktree root and `npm --prefix frontend ci` if node_modules are missing; verify `npx jest --version` resolves the repo's own jest
- [x] 1.1 Add `scripts/lib/jest-timing-capture.cjs` (helper) and `scripts/lib/jest-timing-reporter.cjs` (NDJSON reporter) per design 1-2; verify with unit tests (task 3.1)
- [x] 1.2 Spread the helper into `jest.config.cjs` (label `root`) and `frontend/jest.config.cjs` (label `frontend`); verify `CI=true npx jest --showConfig` for both configs differs only in `reporters` with `HELIO_JEST_TIMING_DIR` set, and not at all with it unset
- [x] 1.3 Add `scripts/ci-load-sampler.cjs` per design 3; verify it self-terminates after `maxSeconds` and on SIGTERM (short local run)
- [x] 1.4 Add `scripts/jest-timing-report.cjs` per design 5; verify against a locally produced capture directory

## 2. Workflow and docs

- [x] 2.1 Wire the frontend job of `.github/workflows/ci.yml` per design 4 (`run: npm test` text unchanged); verify `npm run check:precommit-ci-parity`, `npm run check:ci-complete-needs`, `npm run check:ci-sbt-guard` and `npm run format:check` pass
- [x] 2.2 Document reading the artifact (download, reader command, field meanings, how a stall shows up, and that the sampler stops itself at 18 min so a hung run's load data ends there) in CONTRIBUTING.md near "Local resource caps"; verify the documented commands run against a local capture

## 3. Tests and local proof

- [x] 3.1 Root jest unit tests (`*.test.js` beside each `.cjs`) for helper, reporter, sampler parsers and reader; verify they are collected (listed with non-zero counts), pass, and fail when the logic is mutated
- [x] 3.2 Local opt-in run of a frontend test subset with capture on (CI unset, 3 workers, nice -n 19) plus a temporary uncommitted 1200 ms busy-wait test; verify the reader lists it >= 1200 ms, then delete it
- [x] 3.3 Verify same pass/fail counts and exit status with capture on vs off for the same subset

## 4. CI proof (after the PR exists)

- [ ] 4.1 On the PR's first CI run, download the artifact, run the reader, record artifact size and frontend job / `npm test` step durations vs recent main runs
- [ ] 4.2 Push a scratch commit injecting a 1200 ms busy-wait in one existing frontend test that uses real timers (or via `Atomics.wait`; a `Date.now` loop never ends under fake timers), confirm it appears in the artifact, then push a revert and confirm CI green on the reverted head

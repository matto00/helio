## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b354fd0e47377cf04c469da3fd3cb35fdaf19b35` against the live-resolved base `c1b2e8091c47883deb21111cbf06801f56d174bb` (`resolve-review-base.sh`, exit 0). Two commits: c402520e5 (the capability) and b354fd0e4 (fix: the reader dropped the directory argument when `--top` was absent).

Scope: CI infra only, no UI, so step 4 (design judgment) does not apply.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/ci-jest-timing-load-capture/HEL-1601`.
- **Diff read in full:** `ci.yml` (+29), both jest configs (+3 each), four new `.cjs` files plus their four tests, CONTRIBUTING.md section, and the change artifacts. The `.github` diff contains no `permissions` change (grep returned zero hits). The only action used is `actions/upload-artifact@v7`, which this workflow already uses (the e2e job, around line 682), so no new third-party action.
- **Workflow ordering (parsed with PyYAML, frontend job steps 51-55):**
  1. `Start runner load sampler`
  2. `npm test` with env `HELIO_JEST_TIMING_DIR: ${{ runner.temp }}/jest-timing`
  3. `Stop runner load sampler` (`always()`)
  4. `Summarize jest timing` (`always()`)
  5. `Upload jest timing capture` (`always()`)

  The `run: npm test` text is unchanged.
- **Workflow mechanics:**
  - The sampler is started with `nohup … > sampler.log 2>&1 &`, so stdout/stderr are redirected and it cannot hold the step's pipe open.
  - `$!` goes to `$RUNNER_TEMP/jest-timing-sampler.pid`. The stop step is guarded by `[ -f pid ]`, uses `kill … || true`, and has `continue-on-error`.
  - The artifact path is the same `runner.temp`/`RUNNER_TEMP` directory, with `if-no-files-found: warn` and `retention-days: 14`.
  - The artifact name is `jest-timing-${{ github.run_attempt }}`. The frontend job has no matrix, so the name is unique within a run and a re-run gets a new name.
  - The sampler cap is 1080 s, under `timeout-minutes: 20`.
- **Sampler stops by itself:** in a local scratch run with `maxSeconds=30`, the process was gone afterwards (`ps -p` showed nothing). Separately, the `kill <pid>` path printed `sampler-stopped`.
- **No change to test semantics:**
  - Frontend `CI=true --showConfig` with and without `HELIO_JEST_TIMING_DIR` (seed lines stripped): the only diff is the added `reporters` key, in both the project and global config. `maxWorkers` is 11 in both.
  - With the env unset, `timingReporters` returns `{}` (code read, and covered by unit tests including the `{CI:"true"}` case).
  - No reporter change drops anything CI had: in the installed jest-core (frontend 30.3.0, root 30.2.0), the implicit default is `[[detectAgent() ? 'agent' : 'default']]`. `github-actions` is only added when listed, so CI loses nothing. The reporter never implements `getLastError`, so it cannot fail a run.
- **Start times are wall-clock and survive fake timers:** jest-circus sets `startedAt = jestNow()`, and `jestNow = globalThis[Symbol.for('jest-native-now')] || Date.now`. That is epoch ms on the same clock as the sampler's `Date.now()`, and unaffected by fake timers.
- **End-to-end local probe** (my own scratch config and test under `scratchpad/hel1601/skeptic-final-1/`, wired through the real `timingReporters` helper, the real sampler and the real reader):
  - A 1200 ms busy-wait test was recorded as `"duration":1200` with real `start`/`end` and no `approx` flag.
  - The reader ranked it first (`1200 ms +816 ms [root] stall.test.js :: probe stalled one`), showing 4 overlapping load samples. `--markdown` produced the step-summary table. Exit 0.
  - With `--maxWorkers=2` (two files, so cross-worker IPC), both stalled cases were recorded at 1200 ms with 0 `approx` records.
  - A real frontend subset (`src/utils/aggregate*.test.ts`, 2 suites, 87 tests) under the opt-in run gave 87 `case` records in `jest-timing-frontend.ndjson` with 0 `approx`, and `file` paths are repo-relative (`frontend/src/utils/...`).
  - One probe-authoring slip on my side: my first probe ran a `Date.now` loop under fake timers and hung. That was my test's defect, not the change's (tasks.md 4.2 already warns about it). I killed my own jest pid 178692 and re-ran the probe without the loop.
- **C1 (new tests collected and run):**
  - `npx jest --listTests` in the worktree lists all four new test files under this worktree's paths.
  - A targeted `--verbose` run gave 4 suites and 15 tests passed.
  - The full root suite (`nice -n 19 npx jest --maxWorkers=3`) gave 55 suites and 484 tests passed.
- **Regression for b354fd0e4:** before the fix, `i !== topIdx + 1` with `topIdx = -1` excluded argv[0]. So `main([dir])` and `main([dir, "--markdown"])`, which is the exact CI invocation, returned 2. The new test asserts exit 0 for those forms and that `console.error` is never called, so it would catch the bug.
- **Gates:** prettier `--check` on all changed files passed. `eslint --max-warnings=0` on the changed `.cjs`/`.js` exited 0. `check:precommit-ci-parity`, `check:ci-complete-needs` and `check:ci-sbt-guard` each exited 0.
- **Acceptance criteria trace:**
  - **Per-test durations, start times, load, artifact, retention:** reporter `onTestCaseResult`, `ci-load-sampler.cjs`, and the upload step with `retention-days: 14`. **Met.**
  - **No change to test semantics:** shown by the showConfig diff above. **Met.**
  - **Local runs unaffected:** the helper is `{}` when unset. **Met.**
  - **CI time and artifact size measured on the PR's own CI:** deferred to task 4.1. Not verifiable before Delivery.
  - **Proof on the PR's own CI (artifact parses, 1200 ms stall at the right test, scratch commit reverted):** deferred to task 4.2. The local equivalent is proven above.
  - **Documentation:** CONTRIBUTING.md "Frontend CI jest timing capture (HEL-1601)". The documented reader command ran against my local capture. **Met.**
  - **No new action and no permissions change:** **Met.**

### Verdict: CONFIRM

The work as committed should produce, summarize and upload the artifact on GitHub Actions. Tasks 4.1 and 4.2 (CI-run measurements, plus the 1200 ms stall scratch commit and its revert) stay open and must be verified by the auditor before merge, as the orchestrator stated. This CONFIRM does not cover them.

### Non-blocking notes

- The upload step has no `continue-on-error`. If GitHub's artifact service fails, a green frontend job would turn red. That matches the repo's other upload steps, so I accept it, but the auditor could add `continue-on-error: true` if any flake shows up.
- The capture steps use `if: always()`, so they also run on a cancelled run. They are harmless (guarded, `continue-on-error` on stop and summary). `!cancelled()` would be slightly tidier.
- The root `npm test` is `jest && npm --prefix frontend test`, so a root-suite failure means no `jest-timing-frontend.ndjson`. This was already true before the change and is inherent to the script. It is worth one line in CONTRIBUTING if the artifact is ever found without a frontend file.

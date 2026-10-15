## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: c402520e58ef136011444aa7a23724a9e3a9eb6e (base c1b2e8091c47883deb21111cbf06801f56d174bb, resolved live).

### Phase 1: Spec Review — FAIL
Issues:
- Spec requirement "The artifact is readable in one command", scenario "Reading a downloaded artifact" (reader "exits zero"),
  is not met for the default invocation and the one CI uses. See Phase 2 CR 1. The ticket's "summary in the step summary"
  wiring (design decision 4) is also dead because of it.
- Everything else checks out. ACs 1/2/3/6/7 are implemented. AC 4 and AC 5 (CI measurement and stall proof) are tasks
  4.1/4.2, which are deferred to the PR as the brief allows. Their prerequisites are in place apart from the step summary
  (CR 1): the artifact upload, `retention-days: 14`, the reader with `--top` and the injection guidance in tasks.md.
- Owner constraints are honoured. Only the ci.yml `frontend` job changed. The `- run: npm test` text is unchanged (it only
  gains `env:`). `actions/upload-artifact@v7` was already used in ci.yml (lines 682 and 698), so this adds no new action.
  There is no `permissions` change. Worker counts, retries, timeouts and `CI=true` values are unchanged (see the showConfig
  evidence below). Local runs are unaffected because the helper returns `{}` when `HELIO_JEST_TIMING_DIR` is unset.
- C1 (workflow-state CONSTRAINTS) is honoured. `npx jest --listTests` (CI unset) lists all 4 new files under this
  worktree's path. The full `npm test` run shows `PASS scripts/jest-timing-report.test.js`,
  `scripts/lib/jest-timing-capture.test.js`, `scripts/lib/jest-timing-reporter.test.js` and
  `scripts/ci-load-sampler.test.js`. A verbose run shows 3 + 4 + 3 + 4 = 14 tests passing, all non-zero.

### Phase 2: Code Review — FAIL
Gates, run by the evaluator in WORKTREE_PATH (CI unset, nice -n 19, 3 workers):
- `npm run lint`: exit 0
- `npm run format:check`: clean
- `npm test`: root 55 suites / 483 tests passed, frontend 612 suites / 7268 tests passed, exit 0
- `npm --prefix frontend run build`: exit 0
- `check:precommit-ci-parity`, `check:ci-complete-needs`, `check:ci-sbt-guard`, `check:test-temp-dir-hygiene`: all exit 0
- `CI=true npx jest --showConfig`, capture env set vs unset, for both the root and frontend configs: the only difference
  is `reporters` (plus jest's random `seed`), which satisfies the "no CI=true change" constraint.
- Local opt-in run (`HELIO_JEST_TIMING_DIR` set, frontend `dashboardsSlice` subset, 47 tests): wrote 47 `case` records,
  all with real `startedAt` (0 `approx`) and repo-relative paths.
- Sampler: `maxSeconds=3` wrote 3 lines and exited 0 after 3 s. SIGTERM stopped it at once with exit 0.

Issues:
- **Defect: the reader rejects any invocation without `--top`.** At `scripts/jest-timing-report.cjs:430-431`,
  `topIdx = argv.indexOf("--top")` is `-1` when `--top` is absent, so the filter `i !== topIdx + 1` becomes `i !== 0` and
  drops the directory argument. Probes with a 1-case fixture directory:
  - `node scripts/jest-timing-report.cjs <dir> --markdown` printed the usage error and exited 2.
  - `node scripts/jest-timing-report.cjs <dir>` printed the usage error and exited 2.
  - `node scripts/jest-timing-report.cjs <dir> --top 5` worked and exited 0.

  The CI step `Summarize jest timing` (`.github/workflows/ci.yml`, `run: node scripts/jest-timing-report.cjs
  "$RUNNER_TEMP/jest-timing" --markdown >> "$GITHUB_STEP_SUMMARY"`) therefore writes nothing to the step summary on every
  run, and `continue-on-error: true` hides the failure. CONTRIBUTING.md's "--markdown for the step-summary form" and the
  spec scenario "exits zero" also fail. The unit test `scripts/jest-timing-report.test.js:540` only calls
  `main([dir, "--top", "1"])`, which is why it missed this.
- Everything else is fine. The reporter cannot fail a run: it has no `getLastError`, and every write is in a try/catch.
  It writes incrementally, so a killed job still leaves data. The sampler stops itself and is killed by its recorded PID
  only. Parsing is pure and unit-tested. There is no dead code, no new dependency and no over-engineering.

### Phase 3: UI Review — N/A
No UI-affecting files changed. The only `frontend/**` change is `frontend/jest.config.cjs`, which is test configuration.
The orchestrator confirmed this is a non-UI CI-infra change.

### Overall: FAIL

### Change Requests
1. `scripts/jest-timing-report.cjs:430-432`: fix the argument parsing so the directory is taken correctly when `--top`
   is absent. For example, exclude `topIdx + 1` only when `topIdx >= 0`:
   `argv.filter((a, i) => !a.startsWith("--") && !(topIdx >= 0 && i === topIdx + 1))[0]`.
2. `scripts/jest-timing-report.test.js` ("exits zero for a directory and 2 for bad usage"): add assertions that
   `main([dir])` and `main([dir, "--markdown"])` return 0, and that the markdown output contains the stalled case. Show
   that the new assertions fail against the current line 431 before the fix (red first).
3. Re-run the CI-exact command locally, `node scripts/jest-timing-report.cjs <capture dir> --markdown`, against a real
   opt-in capture directory and show exit 0 with a populated table.

### Non-blocking Suggestions
- `scripts/lib/jest-timing-reporter.test.js` and `scripts/jest-timing-report.test.js` create `mkdtemp` directories under
  `os.tmpdir()` and never remove them. Consider cleaning up in `afterEach`. The hygiene check currently passes.
- Task 4.1 could also confirm that the step summary is non-empty on the PR's first run, since that is the surface that
  was silently broken here.

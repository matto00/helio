## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/ci-jest-timing-capture/spec.md (untracked, on HEAD
c1b2e8091c47883deb21111cbf06801f56d174bb). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio
branch=task/ci-jest-timing-load-capture/HEL-1601`.

### What I verified (with evidence)

- **AC coverage.** Every ticket AC maps to a task. Per-test timing + start times maps to design 2 and task 1.1. Load
  sampling maps to design 3 and task 1.3. Artifact + retention maps to design 4 and task 2.1. Unchanged semantics map
  to the spec requirement and tasks 1.2/3.3. Local runs unaffected maps to design 1 (env-var opt-in). Measured time
  and size map to task 4.1. The 1200 ms stall proof plus revert maps to task 4.2. The docs map to task 2.2. No new
  action and no permissions change map to design 4. No scope drift found.
- **Jest internals (design Context).** Partly correct:
  - Frontend `@jest/core` is 30.3.0. `_setupReporters` uses `this._globalConfig.reporters || [[detectAgent() ? 'agent' : 'default', {}]]`
    (frontend/node_modules/@jest/core/build/index.js:1181). There is no implicit `github-actions` reporter. Correct.
  - **The root suite is NOT jest 30.3.** package-lock.json pins root `jest`/`@jest/core` at 30.2.0. In the main
    checkout's node_modules/@jest/core/build/index.js:1189 the default is `[['default', {}]]` and there is no `agent`
    reporter at all. Listing `"default"` explicitly is still correct for both versions.
  - `startedAt` comes from `jestNow = globalThis[Symbol.for('jest-native-now')] || Date.now`
    (jest-circus/build/jestAdapterInit.js:28,204), so it is real epoch ms that fake timers do not affect. It is the
    same clock as a node `Date.now()` sampler. `TestCaseResult.startedAt?: number | null` and `duration?`:
    @jest/test-result/build/index.d.ts:157,162. `onTestCaseResult` is dispatched from worker `test-case-result`
    events (@jest/core index.js:1124-1129). All correct in both versions.
  - If `reporters` is set and includes `default`, `summaryOptions` is still set, so the SummaryReporter is kept.
- **ci.yml.** The `frontend` job has `timeout-minutes: 20` (line 24) and `- run: npm test` (line 156). It already uses
  upload-artifact v4 and v7 with retention 14/7 (lines 306-319, 653-676). Top-level `permissions: contents: read`.
  Correct.
- **Parity / ci-complete checks.** check-precommit-ci-parity.mjs reads parsed `steps[].run` strings through
  js-yaml. Adding `env:` to the step leaves the `run:` text unchanged, so coverage is unaffected. No new job is added,
  so ci-complete-needs is unaffected. check-ci-sbt-no-pattern-kill.mjs scans ci.yml for pgrep/pkill/killall/pidof and
  `ps|grep`. A `kill "$(cat pidfile)"` passes it.
- **jest-local-caps.cjs.** Returns `{}` under `CI` (line 35). Design 1 does not touch it. Correct.
- **Root testMatch / design 6 claim: FALSE (load-bearing).** See CR1.

### Verdict: REFUTE

### Change Requests

1. **Design 6 / task 3.1: the test plan for the sampler and reader cannot work as written.**
   - **The claim is false.** Design 6 says "`scripts/**/*.test.*` is in the root testMatch". The root testMatch is
     `**/?(*.)+(spec|test).[tj]s?(x)` (jest.config.cjs:6). That pattern does not match `*.test.mjs` or `*.test.cjs`.
   - **The planned modules cannot be loaded.** Design 3 and 5 make the sampler and the reader `.mjs` (ESM). Root jest
     runs CJS, without `--experimental-vm-modules`. `.mjs` is not in `moduleFileExtensions`, and the transform only
     matches `\.tsx?$`.
   - **Reproduced** with the repo's jest 30.2 binary on a scratch dir that mirrors the root
     testMatch/moduleFileExtensions (`scratchpad/hel1601/skeptic-design-1/esmprobe/`):
     - `require("./lib.mjs")` fails: `SyntaxError: Unexpected token 'export'`.
     - `await import("./lib.mjs")` fails: `A dynamic import callback was invoked without --experimental-vm-modules`.
     - A sibling `probe2.test.mjs` was not collected (`Test Suites: 1 total`).
   - **Consequence.** An executor following task 3.1 either hits the import errors or names the tests `*.test.mjs`.
     Those tests would never run, in the hook or in CI, and the suite would still be green.
   - **Required.** Pick one approach and write it into design 6 and task 3.1:
     - (a) put the pure parse/report logic in `.cjs` modules (thin `.mjs`/`.cjs` CLIs are fine) and test them from
       `*.test.js` like `scripts/lib/jest-local-caps.test.js`; or
     - (b) follow the repo's own `.mjs` convention: `scripts/<name>.selftest.mjs`, an `npm run …:selftest` script,
       and a `- run:` step in the CI `frontend` job (as the many existing selftests do).
   - Either way, task 3.1's acceptance signal must include proof that the tests were collected and run (named test
     count in the run output), not just "pass".

2. **Design 3: arithmetic contradiction in the sampler bound.** "1500 s, under the job's 20 min timeout" is wrong:
   1500 s is 25 min. Pick a value that matches the stated rationale (e.g. 1200 s, or less; the sampler only starts
   after ~2-4 min of preceding check steps) or restate the rationale. Update the spec's "bounded duration" accordingly.

### Non-blocking notes

- **Design Context should say root is jest 30.2.0 and frontend is 30.3.0.** The `agent` reporter exists only in
  30.3. The helper must never emit `'agent'`, because root 30.2 would treat it as a custom reporter path and throw.
- **Local opt-in under an agent changes the reporter.** In an agent session (CLAUDECODE set), opting in locally swaps
  the frontend's implicit `agent` reporter for `default`. That does not matter in CI, which sets no agent env vars.
  But the spec's "SHALL keep jest's existing reporter output" only holds there, so scope that sentence to CI, or note
  it. Task 3.3 compares pass/fail counts and exit code, which is unaffected.
- **The worktree has no root `node_modules`** (only `frontend/node_modules`). Tasks 1.2/3.1 need root jest. The
  executor should `npm ci` at the worktree root rather than let `npx jest` fetch an arbitrary version.
- **Busy-wait injection (tasks 3.2/4.2).** Choose a test that does not use `jest.useFakeTimers()`. Under modern fake
  timers, `Date.now()`/`performance.now()` are faked, and a `while (Date.now() - t0 < 1200)` loop never ends. A
  test with real timers, or `Atomics.wait` on a SharedArrayBuffer, is safe.
- **The "same pattern as the e2e job's vite start" analogy is only partial.** That step does not record `$!`. The
  design's pid-file plus `kill` by recorded PID is the right pattern and passes check:ci-sbt-guard.
- **Per-case `appendFileSync` runs in the jest parent.** The cost is likely negligible, but report it in the
  task 4.1 time measurement.

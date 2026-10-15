## Skeptic Report — design gate (round 2, skeptic-design-2.md)

I reviewed ticket.md, proposal.md, design.md, tasks.md and specs/ci-jest-timing-capture/spec.md. The artifacts are
untracked, and HEAD is c1b2e8091c47883deb21111cbf06801f56d174bb. Spawn-cwd guard result:
`READY ambient=/home/matt/Development/helio branch=task/ci-jest-timing-load-capture/HEL-1601`.

### What I verified (with evidence)

- **Round-1 CR1 is resolved (test plan).** Design 6 now plans `.cjs` modules tested from `*.test.js` files placed
  beside them. It quotes the root testMatch correctly (jest.config.cjs:6, `**/?(*.)+(spec|test).[tj]s?(x)`).
  - I confirmed this pattern works in this repo. The root jest in the main checkout ran
    `scripts/lib/jest-local-caps.test.js`, which `require`s `./jest-local-caps.cjs` even though `.cjs` is not in
    `moduleFileExtensions`. Result: `Test Suites: 1 passed`, `Tests: 8 passed`.
  - Lint will cover these files. `eslint.config.cjs:96-102` gives `**/*.{js,...}` the jest and node globals.
  - Collection proof is now required: design 6 and task 3.1 ask for `--listTests` plus the per-file counts and a
    mutation check, and Standing Constraint C1 says the same.
- **Round-1 CR2 is resolved (sampler bound).** The bound is now 1080 s (18 min), which is under the frontend job's
  `timeout-minutes: 20` (ci.yml:24). The spec says "bounded duration shorter than the job's timeout", which is
  consistent.
- **Reporter wiring is sound for both jest versions.**
  - Neither config has a `reporters` key.
  - Neither `npm test` script passes `--reporters`: root is `jest && npm --prefix frontend test`, and frontend is
    `jest --config jest.config.cjs --passWithNoTests`.
  - `_setupReporters` (frontend @jest/core build/index.js:1181-1210) handles `'default'` the same way as the implicit
    default and keeps the SummaryReporter. It adds `github-actions` only when that reporter is listed explicitly, so
    an explicit `["default", custom]` gives the same output in CI as today.
  - The design rules out ever emitting `'agent'`, because root jest 30.2 does not have that reporter.
- **The frontend job wiring fits ci.yml.**
  - `- run: npm test` is at ci.yml:156 and is followed by build steps. The new `if: always()` stop, summary and
    upload steps would sit after it. The build steps keep their default success-only condition.
  - `actions/upload-artifact@v7` is already used (ci.yml:653, 669), so no new action is added.
  - The artifact name includes `run_attempt`, so re-runs do not collide.
  - Stopping the sampler with a pid file plus `kill` avoids name lookups, so it passes check:ci-sbt-guard (verified in
    round 1).
- **AC coverage.** Every ticket AC still maps to a task: capture is 1.1-1.4, workflow and retention is 2.1, docs are
  2.2, unchanged semantics is 1.2/3.3, local runs unaffected is design 1 plus 1.2, measured time and size is 4.1, the
  stall proof plus revert is 4.2, and no new action or permissions change is design 4. I found no scope drift, no
  TODO/TBD, and no contradiction between the proposal, design and tasks.

### Verdict: CONFIRM

### Non-blocking notes

- The spec's "SHALL keep jest's existing reporter output" sentence is still unscoped. The planner note scopes it to
  CI, because opting in locally inside an agent session swaps `agent` for `default`. Consider adding "in CI" to the
  spec text so the final gate does not read it literally.
- Task 4.2 does not repeat the fake-timer caveat; it only appears in the planner notes. A `Date.now()` busy-wait inside
  a fake-timer test never ends. Pick a real-timer test, or use `Atomics.wait`.
- Design 4's comparison to the e2e vite start (ci.yml:625) is only partly right, because that step does not record
  `$!`. The design's pid-file pattern is the correct one.
- If `npm test` ever hangs until the job timeout, the 1080 s sampler can exit before the job is killed. That is
  acceptable, since the samples still cover the stall window, but it is worth one line in the CONTRIBUTING.md docs.

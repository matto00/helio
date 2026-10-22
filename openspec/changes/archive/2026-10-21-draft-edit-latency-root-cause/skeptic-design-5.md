## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Scope: ticket.md ("Owner ruling", "Acceptance Criteria (revised)"), proposal.md, design.md Revision 2 (D7, D8, D8a,
D8b, D9, D10, D11) and tasks.md group 3. Checked against the tree at HEAD cad015c9fd947bf007d7d1cb62a03e9437279fb5.
The artifacts are uncommitted edits in the worktree.

### What I verified (with evidence)

- **cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/draft-edit-latency-flake/HEL-1691`.
- **Round-4 change requests are resolved in the artifacts:**
  - CR1: D8b counts by `projectName`, keeps the guard untagged, and adds a guard-only fixture that must be red. The real
    check and its selftest both run in the CI `frontend` job.
  - CR2: D7 now uses option (i), env-exclusive projects.
  - CR3: D11 spawns the vite binary directly, fails at once on early child exit, passes `BACKEND_PORT` through and
    terminates the child on every exit path. Task 3.6 stops the lane dev server with `stop-servers.sh` first and
    confirms the port is free afterwards.
  - Round-4 notes are also adopted: the guard's positive marker (2xx plus a hashed `/assets/*.js`), the
    `playwright-json-prod-build` artifact name, and the D9 cost basis restricted to the same weights and spec set.
- **D7 env-exclusive mechanics, measured.** I built a scratch replica of D7 on the repo's Playwright
  (`node_modules` symlinked, scratchpad only, no repo writes). It used a `globalSetup` that throws.
  - Env unset, `--list`: only `[dev] › untagged`. The guard file is not matched by `dev`'s default `testMatch`.
  - Env set, `--project=prod-build`: `[prod-build-guard] › guard` and `[prod-build] › tagged`.
  - Env set with no `--project`: the same two. A dropped `--project` cannot reach dev tests.
  - Env set, `--project=dev`: Playwright throws in `filterProjects`. This is the fail-loud path if a shard ever
    inherits the env.
  - `--list` did not run `globalSetup` (the throwing setup never fired). So D8b's `--list` runs in the browser- and
    backend-free `frontend` job are viable.
  - JSON `--list` gives `projectName` per test (`prod-build-guard`, `prod-build`). D8b's projectName partition is
    implementable and failable, and the guard-only case is distinguishable.
- **Regression config:** `playwright.regression.config.ts` spreads `baseConfig` and overrides only `testIgnore`. It
  inherits the env-gated `projects`.
- **Shard script:** `scripts/e2e-shard.mjs` has three Playwright invocations: `plan()`'s `playwrightJson([])` at :210,
  `run()`'s re-list at :252 and the spawn at :254.
  - D9 adds `--project=dev` to all three.
  - `filesFromList` works per file, so `hel1631-draft-mode.spec.ts` stays in the shards for its untagged tests.
  - Weights and profile parsing do not key on `projectName`.
- **Parity check:** `check-precommit-ci-parity.mjs` checks the hook against CI only. A CI-only check does not trip it.
- **Preview serving:**
  - `vite.config.ts` has `server.proxy` for `/api` and `/health` on `BACKEND_PORT`. Preview inherits it.
  - `shellRoutingPlugin` registers `configurePreviewServer`.
  - `API_BASE_URL` defaults to `""` when `VITE_API_BASE_URL` is unset, so a CI build stays same-origin.
- **D8 guard, against real build output.** The worktree's `frontend/dist/index.html` (the landing page served at `/`)
  carries `<script type="module" crossorigin src="/assets/index-rsJjqlUd.js"`, and `app.html` carries
  `/assets/app-Cj2tp6aW.js`. So the guard's hashed-module positive marker is satisfiable against preview. Dev
  injects `/@vite/client` into every HTML response, so the red side holds too.
- **D10:** the burst test is one `test(...)` in a describe with per-test `beforeEach`/`afterEach` and no serial mode.
  Tagging it alone does not split state. No dev-only globals or `IS_DEV` paths are used by the spec.
  - evidence.md section 6 records the local production-build numbers for these same edits: steady edits 2.0-2.1 ms,
    and the build passes the budget at 6x throttle.
- **D9 / CI:**
  - The `e2e` job runs `nohup npx vite --port 5173`, has `timeout-minutes: 25` and uploads `playwright-json-shard-<n>`.
  - `ci-complete.needs` is `[frontend, backend, security, e2e, docker-image]`, and `check:ci-complete-needs` enforces
    the new job's inclusion.
  - The account-wide concurrent-job cap is real (ci.yml:555). D9 measures the queue delay and has a 2-minute
    escalation threshold for it.
  - No step is added to any shard.
- **C1/C2:**
  - No Revision 2 decision changes the assertion lines, and task 3.4 gates them byte-identical to main.
  - Timeouts are never raised; D9 escalates past its thresholds.
- **Coverage and placeholders:** each revised AC maps to tasks.
  - AC1 is done (evidence.md).
  - AC2 (prod build in CI, green, no shard growth) maps to 3.1, 3.2, 3.4, 3.7 and 3.8.
  - AC3 (tag-only opt-in plus a failable check) maps to 3.1, 3.3 and 3.5.
  - AC4 maps to 3.9.
  - No TODO/TBD remains. Proposal, design and tasks agree.

### Verdict: CONFIRM

### Non-blocking notes

- **Tag spelling in JSON:** in `--list --reporter=json`, a test's `tags` appear without the `@` (measured:
  `["prod-build"]`). D8b's checker and its selftest fixtures should be derived from real `--list` output, so a
  hand-written fixture shape cannot make the real check vacuous.
- **The guard checks `/`, which is the landing entry, not the app shell the test measures.** Both come from one build,
  so this is sound in practice. Fetching an app path as well (for example `/pipelines` with `Accept: text/html` →
  `app.html`) would tie the guard to the measured shell for one more line.
- **D9 cost basis:** if fewer than 5 main runs share the current `shard-weights.tsv` and spec set, record the
  fallback used, and the number of runs, in evidence.md rather than silently using fewer.
- **Line citation:** the burst test is at :181 on this branch, while the ticket and D10 cite :177. Cite the test title in
  the PR.
- The CI `frontend` job already runs `npm --prefix frontend run build` (ci.yml:190). No reuse is needed. It only
  confirms that a CI build without `VITE_*` env succeeds.

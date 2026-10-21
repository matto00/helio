## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Scope: ticket.md ("Owner ruling", "Acceptance Criteria (revised)"), proposal.md, design.md Revision 2 (D7-D11, D8a,
D8b), tasks.md group 3. Checked against the tree at HEAD cad015c9fd947bf007d7d1cb62a03e9437279fb5. The artifacts are
uncommitted in the worktree.

### What I verified (with evidence)

- **cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/draft-edit-latency-flake/HEL-1691`.
- **Round-3 change requests are addressed in substance:**
  - env-gated projects (CR1, D7);
  - an automatic setup-project guard (CR2, D8);
  - a durable list check (CR3, D8b);
  - a measurable cost basis (CR4, D9);
  - `serviceWorkers: "block"` (CR5, D8a);
  - an initial timeout of 20 (CR6, D9).
- **D7 mechanics, measured.** I built a scratch replica of D7's config: `dev` with `grepInvert: /@prod-build/` always,
  plus `prod-build-guard` (`testMatch: /prod-build\.guard\.ts/`) and `prod-build` (`grep`, `dependencies`,
  `serviceWorkers: "block"`) only when `HELIO_E2E_PROD_BUILD=1`. It ran on the repo's Playwright 1.55.1
  (`/home/matt/Development/helio/node_modules`, scratch dir only, no repo writes) with `playwright test --list`:
  - env unset: only `[dev]` untagged tests. Tags take part in grep/grepInvert, so D7's partition works.
  - env set, `--project=dev`: only the untagged tests.
  - env set, `--project=prod-build`:
    `[prod-build-guard] › prod-build.guard.ts › guard`, `[prod-build] › tagged`, `[prod-build] › grp › inner tagged`.
    **The dependency project's test is listed too.** This bears on D8b (CR1).
  - env set, file-targeted with no `--project`: all three projects, so dev tests are listed on the prod-build run.
    This bears on CR2.
- **`playwright.regression.config.ts`** spreads `baseConfig` and overrides only `testIgnore`, so it inherits the
  env-gated `projects`. D7's claim holds.
- **Preview serving:**
  - `frontend/vite.config.ts` has `server.proxy` for `/api` and `/health` on `BACKEND_PORT` (line 18). Vite's preview
    proxy defaults to it.
  - `shellRoutingPlugin.ts:26` registers `configurePreviewServer`.
  - The SW is registered by `registerSW({ immediate: true })` (`frontend/src/main.tsx:26`), with `devOptions.enabled:
    false`. That is why D8a is needed, and `block` is a valid context option.
- **`scripts/e2e-shard.mjs`:**
  - `plan()` lists with `playwrightJson([])`. `run()` re-lists and spawns with `fileArg`s only.
  - D9 adds `--project=dev` at all three sites, which is consistent.
  - `filesFromList` works per file, so a file that mixes tagged and untagged tests stays in the shards.
  - `weightsMode` requires exactly 4 `*/results.json` per run dir (`EXPECTED_SHARD_REPORTS`).
- **ci.yml:**
  - `e2e` runs the Vite DEV server on 5173, `timeout-minutes: 25`, and uploads `playwright-json-shard-<n>`.
  - `ci-complete.needs: [frontend, backend, security, e2e, docker-image]`.
  - `check:ci-complete-needs` fails on a job missing from needs, so D9's addition is required and checked.
  - The `frontend` job runs root `npm ci`, so a `--list`-based check can run there.
- **The burst test** now sits at `e2e/hel1631-draft-mode.spec.ts:181`; the ticket's ":177" predates the instrumentation.
  The assertions are at :213-217. `beforeEach`/`afterEach` are per-test, and there is no `serial` mode, so tagging one
  test does not split shared state.

### Verdict: REFUTE

The direction is sound and most mechanics hold. Three issues remain:

- D8b's check, as written, is red on a clean tree, and its obvious fix disarms it.
- AC3's "untagged test would run in the prod-build job" is not covered at the job level.
- D11's server lifecycle is under-specified for this machine, where every lane already has a server on `DEV_PORT`.

### Change Requests

1. **D8b rule (c) fails on the clean tree, and the natural fix disarms it.**
   - The problem: `--list --project=prod-build` also lists the `prod-build-guard` dependency's untagged test (measured
     above). So "every test tagged" is red on a correct config.
   - Why the obvious fix is wrong: an implementer who "fixes" it by tagging the guard `@prod-build` makes "at least one
     test" vacuous. The guard alone satisfies it, so a `grep` typo, or the burst test losing its tag, would pass.
   - Required: D8b selects by `projectName`.
     - (b) counts tests whose `projectName === "dev"`.
     - (c) requires at least one test with `projectName === "prod-build"`, every one of them tagged.
     - The guard stays untagged and is excluded by project, not by tag.
   - The selftest gains a fixture where only the guard is listed. It must be red.
   - Also say explicitly that the real check, not only its selftest, runs in the CI `frontend` job (and in
     `.husky/pre-commit` if you choose, keeping `check:precommit-ci-parity` consistent). As written, "Its selftest ...
     Wired into the CI frontend job" can be read either way.
2. **AC3's second half is certified for the project, not the job.**
   - The AC: "a check that fails when ... an untagged test would run in the prod-build job".
   - D8b only lists `--project=prod-build`. If the CI step's `--project=prod-build` is dropped or mistyped, every dev
     test runs against preview in that job, and no check fails. Measured: env set with no `--project` lists all
     projects.
   - Required, pick one and state it in D7/D8b:
     - (i) **recommended:** when `HELIO_E2E_PROD_BUILD=1`, `projects` is `[prod-build-guard, prod-build]` only, with no
       `dev`. The env alone then decides the partition. A stray env on a shard fails loudly, because `--project=dev`
       becomes an unknown project. D8b rule (b) becomes "env set: no `dev` project / no untagged test".
     - (ii) D8b also parses `.github/workflows/ci.yml`. It asserts that the `e2e-prod-build` job's Playwright step
       carries `--project=prod-build`, and that the `e2e` job neither sets `HELIO_E2E_PROD_BUILD` nor bypasses
       `e2e-shard.mjs`. A fixture shows the red.
3. **D11 / task 3.6 server lifecycle must be safe on a shared-port dev box.**
   - The ports conflict: in a lane, `start-servers.sh` already runs the Vite DEV server on `DEV_PORT`.
     `vite preview --strictPort` on the same port then exits immediately. A "wait for it" that only polls the URL would
     see the dev server answer and run against it. The guard catches that (red), but the script would report a
     misleading failure.
   - If the script spawns `npx vite preview`, its handle is the npx wrapper, not the server. Terminating it may leave a
     `vite` grandchild holding the port.
   - Required: specify that the script:
     - spawns the vite binary directly (for example `node frontend/node_modules/vite/bin/vite.js preview --port
       $DEV_PORT --strictPort`, cwd `frontend/`), so the handle is the server;
     - passes `BACKEND_PORT` through;
     - fails at once if the child exits before it is ready, instead of polling a port someone else serves;
     - terminates the child on every exit path: Playwright exit, spawn error, and SIGINT/SIGTERM of the script.
   - Task 3.6 states the lane procedure: stop the lane's dev server with `stop-servers.sh` first (or use another free
     port for both `DEV_PORT` and preview), and afterwards confirm the port is free.

### Non-blocking notes

- **D8 guard:** "no `/@vite/client`" is a negative-only signal. A 404 or an empty 200 from the port also passes. Prefer
  asserting `response.ok()` plus a positive production marker (a hashed `/assets/*.js` module script) as well as the
  absence of `/@vite/client`. Keep the recorded red against the dev server.
- **D9 artifacts:** if the `e2e-prod-build` job uploads its `results.json`, name it outside `playwright-json-shard-*`.
  Otherwise `weights` regeneration finds 5 reports and throws (`EXPECTED_SHARD_REPORTS = 4`).
- **D9 cost (1):** compare against main runs that have the same `e2e/shard-weights.tsv` and spec set, so each leg's
  file assignment is identical. Otherwise per-leg sums are not comparable.
- **Ticket/D10 cite `:177`:** the test is at :181 on this branch. Cite the title or the current line in the PR.
- **C1:** no Revision 2 decision touches the assertion lines. Task 3.4's byte-identical check is the right gate.

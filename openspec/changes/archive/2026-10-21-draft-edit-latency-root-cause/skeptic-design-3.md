## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Scope: Revision 2 (D7-D11), tasks group 3, ticket "Owner ruling" and "Acceptance Criteria (revised)", checked against the
tree at branch HEAD cad015c9fd947bf007d7d1cb62a03e9437279fb5 (artifacts uncommitted in the worktree) and origin/main 4f729eed7.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/draft-edit-latency-flake/HEL-1691`.
- **Playwright version:** 1.55.1 (`@playwright/test/package.json`). Tags declared with `tag:` take part in `grep` and
  `grepInvert` matching (documented since 1.42), so D7's project split is mechanically sound.
- **`playwright.config.ts` has no `projects` today.** `playwright.regression.config.ts` spreads the base config, so it
  inherits whatever `projects` D7 adds. Playwright has no "default project": a run with no `--project` runs **every**
  project.
- **Vite preview serving:** `frontend/vite.config.ts` defines `server.proxy` for `/api` and `/health`
  (`BACKEND_PORT`). Vite's `preview.proxy` defaults to `server.proxy`. `shellRoutingPlugin` registers
  `configurePreviewServer` with the same rewrite (`frontend/src/landing/shellRoutingPlugin.ts:26`), so SPA navigations
  reach `app.html`. With the same port, origin and cookie shape as the dev server, D7's "same baseURL" claim holds.
- **The PWA service worker is active in preview.** VitePWA has `devOptions.enabled: false`, so the SW is dev-off and
  prod-on. `main.tsx` registers it with `registerType: "autoUpdate"`. Neither D7 nor D9 mentions it.
- **`scripts/e2e-shard.mjs`:**
  - `plan()` calls `playwrightJson([])`. `run()` lists and runs with positional `fileArg`s only.
  - `filesFromList` works per file, so a file with mixed tags stays in the shards, which is correct.
  - `scripts/e2e-shard.selftest.mjs` tests only the pure functions (its one spawn runs `run 5 4`, an argument error). It
    would stay green whether or not `--project=dev` is passed, so task 3.4's "verify selftest passes" proves nothing
    about the change.
- **`check:ci-complete-needs`** (`scripts/check-ci-complete-needs.mjs`) fails when a ci.yml job is missing from
  `ci-complete.needs`. A new `e2e-prod-build` job must be added there, as D9 says. Its guard step runs inside
  `ci-complete`.
- **CI cost premise (gh, main):**
  - Run 39619844110: e2e legs took 16m46s, 23m14s, 22m33s and 17m48s.
  - Run 39615405498: legs took 20m30s, 23m24s, 21m23s and 24m20s, against `timeout-minutes: 25`. The premise holds.
  - Each run already holds 12 concurrent jobs (frontend, security, docker-image, 4 backend, 4 e2e, ci-complete). A 13th
    job fits under a 20-job Free cap for a single run. Overlapping PR and main runs already exceed it.
  - Leg wall time varies by roughly 7 min from run to run.
- **HEL-1632:** `e2e/hel1632-*` does not exist on this branch or main. It lives only on PR #1075's branch, so it can
  only opt in later.
- **C1:** none of D7-D11 touches the assertion lines. Task 3.3 requires them to be byte-identical to main.

### Verdict: REFUTE

The direction is right and most of the mechanics hold up. The plan still has two contradictions with the revised
acceptance criteria, and one false claim about default behavior.

### Change Requests

1. **D11 is false as designed: a plain `prod-build` project runs in the default local run.**
   - With `projects: [dev, prod-build]`, a bare `npx playwright test` (root `npm run e2e`) runs both projects.
   - It also runs both for any file-targeted run such as `npx playwright test e2e/hel1631-draft-mode.spec.ts`, and for
     `playwright.regression.config.ts`, which spreads `projects`.
   - In each case the tagged burst test runs against the dev server. The D8 guard then makes every default local run red.
   - Required: specify the mechanism. Options:
     - include `prod-build` in `projects` only when an env var is set (for example `HELIO_E2E_PROD_BUILD=1`, set by the
       CI job and `npm run e2e:prod-build`);
     - or accept a red default run and say so (not recommended).
   - Add a task step that verifies a bare `npx playwright test --list` contains no tagged test.
2. **AC3 says a second spec opts in "by a tag alone", but D8 requires every tagged test to call a helper first.** A
   spec that adds only the tag would run unguarded in the prod-build job, and on the dev server if it ever got there.
   - Required: make the guard automatic for tagged tests. Options:
     - an auto fixture in `e2e/support/prodBuild.ts`, attached project-wide, that asserts when `testInfo.tags` includes
       `@prod-build`;
     - or a setup project that `prod-build` depends on.
   - Make it independent of the test's own navigation, for example by fetching `baseURL + "/pipelines"` HTML through
     `request` and asserting there is no `/@vite/client`.
   - D10 and task 3.3 then add only the tag to the burst test.
   - State in D7 that HEL-1632 needs exactly `tag: "@prod-build"` and nothing else.
3. **AC3's second half has no check.** The AC requires "a check that fails when … an untagged test would run in the
   prod-build job". D8 covers only "tagged on the dev server". Task 3.1 is a one-time `--list` eyeball, not a check.
   - Required: name a durable check with its red. For example, the `e2e-prod-build` job (or a script it runs) lists
     `--project=prod-build --reporter=json` and fails, naming the test, if any listed test lacks the tag or the list is
     empty. A mirror assertion on `--project=dev` fails if any listed test carries the tag.
   - Demonstrate the red by temporarily dropping the `grep` (or `grepInvert`) and recording the failure.
   - Task 3.4's selftest claim cannot serve as this evidence (see "What I verified").
4. **The C2 escalation trigger is not measurable as written.** "No e2e shard's duration grows meaningfully" is compared
   between one PR run and main, but leg wall time varies by about 7 min between consecutive main runs (16m46s-24m20s
   above). A single comparison cannot detect growth, and could not refute it either.
   - Required: define the basis and the threshold in D9/task 3.7. For example:
     - shard step-level time for the "Run e2e suite" step, plus the summed test durations from each leg's
       `results.json`, against the median of N recent main runs;
     - a stated threshold, for example more than 60 s over that median, or any non-test step added to the shard job.
   - Record the structural argument as the primary claim: the only shard change is the `--project=dev` argument, and no
     step is added.
   - For the concurrent-job limit, name the measurement: the `e2e-prod-build` job's `startedAt` minus the run's
     `createdAt`, and whether `ci-complete`'s start is delayed past the slowest e2e leg's completion.
5. **The service worker under `vite preview` is not decided.** In the prod build, `main.tsx` registers the PWA SW with
   `autoUpdate`.
   - On a fresh context it installs and precaches roughly 4 MB of assets in the background while the test runs. That
     is a perturbation the dev-server baseline never had, and a possible takeover or reload path mid-test.
   - Required: D7 states the decision. Either set `serviceWorkers: "block"` on the `prod-build` project (recommended for
     a latency measurement; Firebase-served users do get the SW, but it is not on the edit path), or keep the SW and
     justify that with a measurement.
6. **D9 timeout sizing.** "Own `timeout-minutes` sized from its measured duration" has no value for the first run.
   - Required: state an initial value. For example 20, which mirrors e2e setup plus a build, roughly 2.5x a
     conservative estimate.
   - Task 3.7 then tightens it from the measured duration, as HEL-1288 and HEL-1427 did.

### Non-blocking notes

- `e2e/shard-weights.tsv` still weighs `hel1631-draft-mode.spec.ts` with the burst test included, so the file is slightly
  overweighted until the next regeneration. That is harmless, but worth a sentence in the PR body. Do not hand-edit the
  table.
- With `--project=dev`, also pass it to the `verifySelection` re-list in `run()`, not only to `plan()`, so the list and
  the run select from the same project, as D9 says.
- `npm run e2e:prod-build` (D11) needs `BACKEND_PORT` exported for the preview proxy. It must stop preview without a
  hand-written kill. `stop-servers.sh` is concertino-rendered and gitignored, so a tracked root npm script cannot depend
  on it outside a lane. Record how the script stops its own child, for example by running preview as a child and
  trapping its PID.
- The `e2e-prod-build` job's `vite build` adds no time to the shards and runs in parallel. It finishes far below the
  slowest e2e leg, so it should be off the critical path. Confirm that with the run's timestamps.

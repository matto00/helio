## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b86d15faba16d2d2f1b6a384e44ad1272f0489cd` against the base resolved live by `resolve-review-base.sh` (`4f729eed7dd52150f056b6f5a20eac856cb794a7`, rc=0). Read the full code diff of 25 files: ci.yml, playwright.config.ts, the hel1631 spec, prod-build.guard.ts, hel1691Breakdown.ts, the check script and its selftest, e2e-prod-build.mjs, e2e-shard.mjs, package.json, CONTRIBUTING.md and e2e/README.md. Treated evidence.md, evaluation-1.md and evaluation-2.md as claims to check. No UI change, so step 4 (design judgment) does not apply. I read no `.env` file (CON-261).

### What I verified (with evidence)

**Root cause against the CI evidence (AC1)**
- I recomputed the D2 trace of failing sample 39624162187-2 independently (`ci/39624162187-2/report/.../hel1691-burst-trace.json`), using the `TimeStamp` marks and Δts/Δtts on the same tid. Edits 1-10 match evidence.md exactly: edit 2 is 91.8 wall / 48.4 thread, and edit 4 is 57.0 / 42.1. Inside edit 2, 91.1 ms of 91.8 ms falls under one `EventDispatch` > `v8.callFunction`, so the interval is one synchronous task, with no GC and no style or layout. D3's 50% contention line puts edit 2 just on the script side (47% off-CPU). evidence.md discloses this, so it is not a hidden borderline case.
- The strongest support for the dev-build diagnosis is on CI, not local. I read the `e2e-prod-build` job log of run 39681692001 myself. Against the production build on a CI runner, the burst edits ran 13.6, 5.8, 4.6, 4.6, 4.0, 4.9, 3.2, 3.3, 2.9 and 3.4 ms wall. The same edits on the dev build on CI ran about 20-50 ms (evidence.md tables). The guard passed (80 ms) and the burst test passed. The only variable between the two arms is the build, so CI confirms dev-build-only cost.
- The `e2e-prod-build` job on the current head (run 39687189543, sha b86d15fab) also concluded `success`. The rest of that run was still in progress when I checked.

**C1: assertions unchanged**
- I ran `diff` of `git show 4f729eed7:e2e/hel1631-draft-mode.spec.ts` against HEAD. The only hunks are the import, the `BURST_TITLE` const, the `test(BURST_TITLE, { tag: "@prod-build" }, ...)` header, the `startBreakdown` and `breakdown.measure`/`log()` wrapping of the edit loop, and the `breakdown.log()` call. The `toBeLessThan(100)` and `toBeLessThan(50)` lines and `timedFilterEdit` (the MutationObserver scope) are byte-identical to main.
- The wrapper's CDP calls run outside the in-page `performance.now()` interval, so they do not touch the measured value. `recordApi` sees no CDP traffic.

**C2: no timeout raised**
- The only timeout in the diff is the new job's `timeout-minutes: 8`, lowered from 20. The e2e legs stay at 25.

**The harness cannot silently measure the wrong build**
- Prod-build project pointed at the Vite DEV server: I started the lane stack with `start-servers.sh` (`assert-phase` PASS), then ran `HELIO_E2E_PROD_BUILD=1 npx playwright test --project=prod-build` under flock, nice and 1 worker. Result: `1 failed` (`/ must not load the Vite dev client`), `1 did not run`, rc=1. The guard is red, and the burst test is skipped as a dependency.
- Prod-build project against a production build: green in CI (the run 39681692001 log above). The local run log `local/prodbuild-run2.log` shows the guard passing and edits at 1.4-6.0 ms.
- `HELIO_E2E_PROD_BUILD=1 ... --list --project=dev` fails at `filterProjects`, rc=1. A shard runner launched with the env set fails loudly rather than running dev tests on preview.
- `HELIO_E2E_PROD_BUILD=true` throws `must be unset or 1`.
- With the env unset, the file-targeted list of hel1631 shows only `[dev]` tests, 10 of them, without the burst test.
- The CI shard reports confirm the split. I parsed results.json for every available leg of both PR runs: legs 1-4 of 39677346014 and legs 1-3 of 39681692001. The only project is `{dev}`, the burst test appears 0 times, and leg 3 holds the 10 other hel1631 tests.

**AC3: a second spec opts in by tag alone**
- I wrote a scratch-only config: it spreads the real `playwright.config.ts` projects, sets testDir to a scratch dir, and repoints only the guard's testMatch. The scratch spec has one describe holding an untagged test and a `{ tag: "@prod-build" }` test.
- With the env unset, the list is `[["dev","untagged sibling",[]]]` with violations `[]`.
- With the env set, the list is `prod-build-guard` plus `["prod-build","latency budget",["prod-build"]]` with violations `[]`.
- So the tag alone routes a test, even next to an untagged sibling in the same describe, and the real `violations()` accepts it.
- `npm run check:e2e-prod-build-projects`: clean, rc=0. `:selftest`: 11 cases, rc=0. The selftest's red fixtures cover each rule, including a run where only the guard is listed. The executor's mutation probes on the real list are recorded in evidence.md §8. I did not repeat them, because I may not edit code; the selftest covers the same rules.

**Other gates (run fresh)**
- `check:e2e-shard:selftest` (15 cases), `check:ci-complete-needs` (6 needs, including `e2e-prod-build`) and `check:e2e-types` all exit 0.
- `e2e-prod-build` mirrors the `e2e` job's services, env, backend start and artifact steps. Its artifact name `playwright-json-prod-build` does not match the `playwright-json-shard-*` download pattern. If someone downloads every artifact, `validateRunReports` refuses anything but exactly 4 reports, so it fails loudly rather than silently.
- D2 is removed: a grep for `HEL1691_`, `Tracing.` and `timeStamp` across e2e/, scripts/ and the config finds nothing. The D1 breakdown is kept and logged before the first `expect`.

**Could the diff have caused the e2e (4) 25-minute timeout on run 39681692001?** (comment only; the decision is reserved for the owner)
- `node scripts/e2e-shard.mjs plan 4` gives byte-identical output on the main checkout (at 4f729eed7) and on HEAD: 96 lines, `diff` empty. Leg 4 gets the same spec files as on main.
- The only test the diff removes from the dev legs is the burst test, which sat in leg 3.
- The leg-4 log shows `Running 182 tests using 2 workers`, 179 `[dev]` passes, no failures, and then `The operation was canceled`.
- The new job runs on its own runner and finished about 21 minutes before the leg.
- Conclusion: the diff did not change leg 4's work. The timeout is the pre-existing HEL-1667 headroom problem. It still turns `ci-complete` red on this PR until the owner rules.

### Verdict: CONFIRM

The AC1 diagnosis holds up against the CI trace and, more decisively, against the CI production-build run. AC2 (revised) is met for the opted-in test: the burst test runs only against a guarded production build in CI with its assertions unchanged, and both PR runs are green. The D9 shard-cost threshold and the e2e (4) timeout belong to the owner, as briefed. AC3 is proven by the real check, its selftest, and my scratch second-spec probe. AC4 (10 main runs) is the driver's after merge.

### Non-blocking notes

- evidence.md §1 still says the D1 breakdown is "appended to the two latency failure messages" and lists `HEL1691_*` switches as present. That was true during diagnosis, not at HEAD; design.md D10 and the code are correct. Worth a one-line "(diagnosis-time; removed in D10)" marker.
- CONTRIBUTING.md and the spec comment say React's dev runtime is "~60% of an edit's cost on a CI runner". The 60% comes from the local V8 profile (evidence.md §5 says no JS profile exists from CI). The CI prod-build run (3-6 ms against about 30 ms dev) suggests a larger share on CI. Consider rewording to "measured locally", and adding the CI prod-build per-edit numbers to evidence.md §9: they are the best CI-side proof and are not recorded there.
- Guard residual: it proves "no Vite dev server, hashed bundle". It would not catch a production-shaped bundle built with `NODE_ENV=development`, which keeps React's dev runtime. `--no-deps` would also skip it. Neither is reachable through the CI job or `npm run e2e:prod-build` as written. A cheap hardening for later is to assert in-page that React is in production mode.
- `scripts/e2e-prod-build.mjs` stops its preview child on SIGINT/SIGTERM but does not forward the signal to the Playwright child. On Ctrl-C this is harmless (same process group); an external SIGTERM to the node process alone would leave Playwright running.
- If HEL-1632's spec puts a tagged test in a `describe.serial` with untagged tests, the project split would separate them. Its lane should keep a tagged test self-contained.
- Gate-defect check: no report I read relies on mtime ordering, so there is nothing to flag under CON-160.

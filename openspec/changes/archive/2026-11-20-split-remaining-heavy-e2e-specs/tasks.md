## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file (backend/.env, frontend/.env, infra/.env.deploy etc.), not even to compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); only scripts may read scripts/concertino/.concertino.env, never print it. Never copy .env files or a tree containing one (cp -a, rsync, hardlinks).
- [C2] Quoted heredocs only (<<'EOF'), even when the body looks harmless.
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with scripts/concertino/stop-servers.sh; delete test residue with buildUserDeleteSql by exact id; plain emails.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; never a background run past the tool timeout.
- [C8] No prod, no release, no concertino sync, no MCP deploy; never edit CD or release workflows.
- [C12] Red first where a behaviour changes; for pure splits, prove test-count and assertion parity (playwright --list before/after, per title path) and commit the before-list first.
- [C13] Scratch in .concertino/scratch/HEL-1789/ in the main checkout (/home/matt/Development/helio/.concertino/scratch/HEL-1789/), never committed; anything a follow-up must reference is copied to .concertino/runs/HEL-1789/evidence/ before Delivery.
- [C14] Local e2e only against a lane-private DB helio_hel1789 (createdb; DATABASE_URL for start-servers.sh AND Playwright; DB_USER when the URL has no credentials); ANTHROPIC_API_KEY exported empty for any backend. Dropped at Delivery.
- [C15] Measure only from GitHub CI artifacts/API, never local timings.
- [C16] Never edit HEL-1790's files (e2e/hel1675-shared-hover.spec.ts, e2e/support/hel1790Rest.ts, e2e/hel1790-hover-probe.spec.ts) or any other sibling lane's spec; never rerun main-branch runs; no whole-run or --failed reruns.
- [C17] No product code, no schema, no migration; no change to timeout-minutes, leg count or the partition algorithm.
- [C19] The split parity proof covers, per test, the whole scope chain (enclosing test.use, describe.configure, file/describe setTimeout/slow, out-of-body skip/fixme, every hook's source) and counts expect( in test AND hook bodies; it is shown able to fail by one mutation.
- [C18] Test code shared by several split parts lives once in an e2e/support module, called from each part, never copied.

## 1. Variance cause (before any split)

- [x] 1.1 Rebuild the measurement scripts in scratch (design Decision 1): download `playwright-json-shard-*` for the main population (HEL-1778 before set + counting main runs since d8cdfb460) and the surviving PR #1183 run 44599315768 data (JSON where present, job-log `list` lines otherwise); record which runs count and why the others do not, with each run's source.
- [x] 1.2 `specvar.mjs`: for each of the six specs, sums per run, median, swing, share; spec ratio vs leg ratio vs rest ratio; per-test spread and largest-swing tests; in-file mode; per-test medians for split balancing. For every run: slowest leg, excess over mean, ranked drivers.
- [x] 1.3 Read the test bodies of any spec classified spec-specific and name what its slow tests wait on.
- [x] 1.4 Write `variance.md` in this change directory: one section per spec (numbers, cause, remedy, part boundaries with per-part median); slowest-leg table per run with drivers; apply the stop rule (Decision 1) before splitting.

## 2. Leg-wide slowdown from existing CI data (Decision 4a)

- [x] 2.1 Per leg per run: the leg factor; for the slow legs, what the job logs and jobs API show (runner name, image version, "Set up job" host lines, CPU-bound setup step durations, leg index, start time); whether the factor is constant through the leg or starts mid-leg (per-test start times).
- [x] 2.2 Add to `variance.md` a section stating what the artifacts show and what they cannot show.

## 3. Split (no test lost or weakened)

- [x] 3.1 Capture the before lists (`--list --reporter=json --project=dev`, and with `HELIO_E2E_SLOW=1`), reduce to `project | describe chain > title`, write `list-before.txt` / `list-before-slow.txt` into this change directory and commit them first (C12).
- [x] 3.2 Serial-file dependency check (Decision 2) for each spec without `mode: "parallel"`.
- [x] 3.3 Split the six specs per `variance.md`'s boundaries (hel1575-dashboard-tabs, hel1582-sweep-375 via narrower register functions in `e2e/support/hel1582Phone.ts` with `registerHeavySweeps` kept (as implemented: all three are wrappers over a private `registerSweeps(size, kinds)` that selects the tests with `kinds.includes(...)`), hel1582-mobile-pipeline, hel1684-draft-structural, state-surface-contrast-guard, hel1573-motion-primitives); shared code once in `e2e/support/`; each part repeats file-level configure/setTimeout/use.
- [x] 3.4 References to the old file names (design Decision 2): repoint `package.json` `e2e:state-contrast-guard` to a path filter matching every part and show `npm run e2e:state-contrast-guard -- --list` lists every part's tests; repoint any `e2e-slow.yml` / `playwright.config.ts` / script reference; update comment-only references (`e2e/`, `frontend/src/app/App.css`, `frontend/src/theme/themeParityGuard.css.test.ts`, `frontend/src/features/dashboards/tabs/ui/DashboardTabBar.css.test.ts`, `frontend/src/features/pipelines/ui/mobile/PipelineMobile.css.test.ts`, `DESIGN.md`, `e2e/README.md`) as comment/doc-only edits, each in files-modified.md; final grep for each old full file name (`<stem>.spec.ts`) outside the archive and this change is zero (bare stems may remain, per design Decision 2).
- [x] 3.5 Parity proof (Decision 3): `list-after.txt` / `list-after-slow.txt` identical multisets with the before lists; AST body comparison zero differences; per-test scope-chain parity (every enclosing `test.use`, `describe.configure`, file/describe `setTimeout`/`slow`, out-of-body `test.skip`/`fixme`, every hook's source) zero differences; `expect(` counts over test AND hook bodies equal per original file; named checks for hel1684's afterEach count429 assertion and hel1582's MAXIMAL skip gate + mobile `test.use`; one mutation shows the scope proof can fail; summarise in `variance.md`.
- [x] 3.6 `npm run check:e2e-types`, `check:e2e-user-cleanup`, `check:e2e-evidence-paths`, lint and format pass; run each new part once locally against helio_hel1789 (correctness only, not timing).

## 4. Per-leg runner record (Decision 4b)

- [x] 4.1 (not needed: the sampler is reused unchanged; the runner identity is a workflow step) If `scripts/ci-load-sampler.cjs` is changed, add the failing test case first in `scripts/ci-load-sampler.test.js` and show it red, then green.
- [x] 4.2 Add to the `e2e` job in `.github/workflows/ci.yml`: runner-identity step (CPU model, nproc, MemTotal; no env dump) to a file and the step summary, background sampler started as the first step after checkout with recorded PID and self-stop bound 1400 s (no `results.json` ever in the artifact directory), stop step after the suite, upload `e2e-runner-shard-${{ matrix.shard }}`; every new step non-failing (`if: always()`, `continue-on-error: true` where it can fail). Confirm the name does not match the weights tool's report pattern and that `check:e2e-shard:selftest` and every ci.yml-parsing check still pass.
- [x] 4.3 Write the scratch reader that turns a run's `e2e-runner-shard-*` artifacts into per-leg CPU model / steal / run queue next to the leg factor.

## 5. Weights and before set

- [x] 5.1 Regenerate `e2e/shard-weights.tsv` with `--list` from the branch head over the 5 most recent counting 7-leg main runs (Decision 5); record re-attributed and dropped counts; list any defaulted spec (e.g. HEL-1774 files if no counting main run contains them) and why.
- [x] 5.2 `node scripts/e2e-shard.mjs plan` before and after: predicted per-leg loads.
- [x] 5.3 `measure.mjs` (jobs API: slowest/mean leg, headroom, test step vs setup, per-leg median/max, imbalance, counting rule) run on the before set; save `before.md` in scratch.
- [x] 5.4 Commit (pre-commit hooks pass) with `files-modified.md` listing every file; copy scratch measurements into `.concertino/runs/HEL-1789/evidence/`.

## 6. Delivery measurement (orchestrator)

- [ ] 6.1 After HEL-1790 merges: merge main, regenerate weights (Decision 5) before any measurement run.
- [ ] 6.2 PR first run plus empty-commit measurement pushes, sequential, until 5 counting runs or 8 total (fewer than 5 counting after 8 = AC3 unmet, escalate); download each run's artifacts as it completes; per-run slowest/mean leg, headroom, runner record per leg; clauses of the balance and headroom requirements; any run over 1200 s with its driver. No whole-run reruns; any single-job rerun named in the PR.

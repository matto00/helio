## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: `72636f1fd18eec57968a768414c37479b2d5e5a0` against base `4f729eed7dd52150f056b6f5a20eac856cb794a7` (resolved live
via `resolve-review-base.sh`; equals `origin/main`). No `frontend/**` or `backend/**` file changed.

### Phase 1: Spec Review — FAIL (one artifact mismatch, see CR3)

- Revised AC "runs in CI against a production build, budget and assertions unchanged, green on the PR's CI": met. Run
  39685704960 at HEAD, job `e2e-prod-build` success (150 s). Its `playwright-json-prod-build` report shows `expected 2,
  unexpected 0`: `prod-build-guard` passed, burst test passed in `prod-build` with edits 9.0, 3.3, 3.4, 3.7, 3.4, 3.1, 2.7,
  2.8, 2.8, 2.8 ms. The "no shard grows meaningfully" half is the open C2 escalation and is not judged here.
- Revised AC "a second spec opts in by tag alone, proven by a failable check": met (Phase 2 has the mutation evidence).
- C1: holds. Every `expect`/`MutationObserver`/`.spine-row__count`/`latencies` line of `e2e/hel1631-draft-mode.spec.ts`
  is byte-identical to `origin/main`. The one differing `latencies.push(...)` line now wraps the same `timedFilterEdit` call
  in `breakdown.measure`. The CDP reads are outside the `page.evaluate` window, so the measured interval is the same.
- C2: no `timeout-minutes` raised. The new job's limit went 20 -> 8, and the e2e legs are untouched.
- CON-261: no `.env` file was read. The diff reads none.
- D7, D8, D8a, D8b, D9 (structure), D10 (except the wording in CR3) and D11 are implemented as written. Tasks 3.1-3.8 are
  ticked and match the diff. 3.9 is correctly left open for the driver.
- Scope: no creep. The diagnosis scaffolding (trace, HEL1691_* switches) is gone from the final tree.
- CR3: design.md:138-139 (D10) says the D1 breakdown "is appended to the failure messages". The implementation logs it
  before the first `expect`, which is the only way to satisfy C1. The artifact does not reflect the final behavior.

### Phase 2: Code Review — FAIL (comment/doc accuracy, CR1-CR2)

Gates, run fresh in WORKTREE_PATH (no frontend/backend paths changed, so jest/build/sbt are not triggered):
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run check:e2e-types`: exit 0
- `npm run check:e2e-prod-build-projects`: clean
- `npm run check:e2e-prod-build-projects:selftest`: 11 cases passed
- `npm run check:e2e-shard:selftest`: 15 cases passed
- `npm run check:ci-complete-needs` and its selftest: OK, 6 needs including `e2e-prod-build`

Independent failability probes. These were scratch configs outside the worktree that spread the real config and override
only `projects`, fed to the real `violations()`:
- `dev` project without `grepInvert`: RED, "env unset: @prod-build test would run on the dev server: hel1631-draft-mode.spec.ts ...".
- `prod-build` project without `grep`: RED, with 663 "untagged test would run in prod-build" violations.
- Real config: env unset lists 663 tests, all in `[dev]`. Env=1 lists exactly guard + burst (2 tests).
  `HELIO_E2E_PROD_BUILD=1 ... --project=dev` errors out, so it fails closed.
- Guard RED against the lane's Vite dev server (7123/10030, under the e2e lock, nice 19, 1 worker, trace retain-on-failure):
  `1 failed` (`/ must not load the Vite dev client`) and `1 did not run` (the burst test, a dependency skip).
- Guard GREEN against `vite preview` comes from CI at HEAD (above). The local `npm run e2e:prod-build` GREEN was not re-run.
  The CI job exercises the same preview path, and the executor's local run is recorded in evidence.md section 8.

Code observations:
- `ci-complete` treats `e2e-prod-build` like every other need (`contains(needs.*.result, 'failure'|'cancelled')`).
- `scripts/e2e-prod-build.mjs`: stops its preview only through the child handle, on exit, error, SIGINT, SIGTERM and
  uncaughtException. It refuses an occupied port before building and fails at once if preview exits early. This is sound.
- `e2e/prod-build.guard.ts`: checks status 2xx, the absence of `/@vite/client` and a hashed `/assets/*.js` module
  script on the SPA shell. This is fail-closed, as D8 requires.
- `scripts/e2e-shard.mjs`: `--project=dev` on `--list`, the re-list and the run. The shard plan is unchanged from main
  (`e2e/shard-weights.tsv` untouched; hel1631 already "defaulted", 43 s, leg 3).
- CR1: `playwright.config.ts:38` ends "See e2e/README.md and CONTRIBUTING.md." `e2e/README.md` has nothing about
  `@prod-build`, `HELIO_E2E_PROD_BUILD`, the guard or the `e2e-prod-build` job. Its "CI runtime" section (README:89-91,
  "The CI `e2e` job runs `node scripts/e2e-shard.mjs run <i> <N>` ...") also does not say that the shard legs now run only
  `--project=dev`, or that tagged tests run elsewhere. So the pointer is false, and the README's CI description is now
  incomplete.
- CR2: `.github/workflows/ci.yml:822-831` copies the e2e job's "HEL-910 task 6.3 note" about the Sleeper MCP rebuild
  test ("deliberately NOT wired in here ... this job currently provisions") into `e2e-prod-build`. That note is about the
  general e2e job. In a job that runs only `@prod-build` latency tests it is irrelevant and misleading, which breaks the
  CONTRIBUTING.md "Comments" standard: every comment must carry something true about the code it sits on.

Could anything in the diff make the dev shards slower? Nothing plausible:
- **Config:** a single named project with `grepInvert` is a load-time title/tag filter. The only side effect is a `-dev`
  suffix on per-test output dirs. The repo has no `toHaveScreenshot`/`toMatchSnapshot` (grep: 0 hits), so snapshot path
  templates are not affected.
- **Arguments and test set:** `--project=dev` adds no work. Reporters are unchanged (`list` + `json`). The legs lose one test
  (the burst test, about 6.6 s including setup).
- **Shard assignment:** identical to main, because the weights file and the file set are unchanged.
- **New job:** `e2e-prod-build` runs on its own runner. It only costs a concurrent-job slot (measured queue delay 1-2 s),
  which can delay a leg's start but not its in-job duration.
- **Leg 4 cancellation:** on run 39681692001 leg 4 was cancelled at 25 min. Leg 4 does not contain hel1631 and runs the
  same files as on main. The diff has no mechanism that would lengthen it. This points to leg variance against a timeout
  that main legs already approach (24:51 on the previous PR run 39677346014), which is the subject of the C2 escalation.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: FAIL

### Change Requests
1. `playwright.config.ts:38` points to `e2e/README.md`, which has no matching content. Add a short paragraph to
   `e2e/README.md`'s "CI runtime" section (near line 91). It should say: the shard legs run `--project=dev` only;
   `@prod-build` tests run in the separate `e2e-prod-build` job against `vite preview`, behind the `prod-build-guard`
   setup project; locally use `npm run e2e:prod-build`; `npm run check:e2e-prod-build-projects` guards the partition.
   Alternatively, drop "e2e/README.md and" from the config comment. Adding the paragraph is preferred, because the README
   is where the e2e CI layout is documented.
2. `.github/workflows/ci.yml:822-831`: delete the copied "HEL-910 task 6.3 note" block from the `e2e-prod-build` job. It
   describes the general `e2e` job, not this one. Also reword the copied GOOGLE_* comment's "which this guard never uses"
   if it does not apply to this job, or keep it only if it is accurate here.
3. `openspec/changes/draft-edit-latency-root-cause/design.md:138-139` (D10): change "appended to the failure messages"
   to the implemented behavior. The breakdown is logged (one line per edit plus one JSON line) before the first `expect`,
   so it reaches `results.json` stdout on pass or fail, and the assertion messages stay byte-identical (C1).

### Non-blocking Suggestions
- design.md D9 says `e2e/shard-weights.tsv` "slightly over-weights hel1631 until regenerated". `scripts/e2e-shard.mjs plan 4`
  shows hel1631 has no weight row ("defaulted", 43 s), so nothing is over-weighted. Correct the note when you touch
  design.md for CR3.
- For the skeptic and the owner: the prod-build measurement also runs on a runner whose only work is 2 tests. The dev legs
  run 2 workers beside other tests. CI prod edits came in at 2.7-9.0 ms, about 13x below dev. That is consistent with the
  local 6x-throttle result in evidence.md (7x), but it is no longer the same contention profile as the dev baseline. This
  falls within the owner ruling and is not a defect.

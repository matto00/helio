## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `33dcf8fd22fe21f4823697aec101033e7f637c30` (the change dir is still untracked).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/rebalance-e2e-shard-weights/HEL-1361`.
- **Ticket fidelity:** the Linear HEL-1361 description matches ticket.md's Description and Do sections. AC1-AC4 are a fair operationalisation of them. AC4 (the HEL-951 contract) is a reasonable added constraint, not scope drift.
- **Playwright 1.55 claims** (repo-root `node_modules/playwright`, version 1.55.1, which matches the worktree `package-lock.json`):
  - `lib/runner/testGroups.js:95-112` `filterForShard` cuts groups by `group.tests.length`, i.e. by test count. It has no weighting. CONFIRMED.
  - `lib/util.js:178-183` `forceRegExp`: a non-`/.../` arg becomes `new RegExp(p, "gi")`, so it is unanchored and case-insensitive. CONFIRMED.
  - `lib/util.js:109-140`: a CLI arg is a regex tested against the file path, and `lastIndex` is reset. So D4's anchored `/(^|\/)e2e\/<escaped>$/` form works as intended.
- **ci.yml:** the `e2e` job has 4 legs, `max-parallel: 4`, and step `npx playwright test --shard=${{ matrix.shard }}/${{ strategy.job-total }}` (lines 568-569). The JSON artifact is `playwright-json-shard-N`. `playwright.config.ts` sets CI `workers: 2`, the JSON reporter writes to `test-results/results.json`, and `testIgnore` has 8 entries. CONFIRMED.
- **Baseline leg data** (recomputed from `scratchpad/before.tsv`, 25 runs x 4 legs):

  | Leg | Leg median | Leg max | Step median | Step max |
  |---|---|---|---|---|
  | s1 | 370 | 860 | 190 | 240 |
  | s2 | 384 | 577 | 208 | 236 |
  | s3 | 355 | 393 | 184 | 205 |
  | s4 | 405 | 614 | 228 | 254 |

  These match the premise file exactly.
- **Per-file weights:** I recomputed these myself from the 5 baseline runs' `results.json` (900 results, all passed, retries 0).
  - `state-surface-contrast-guard.spec.ts` has a median of 273.5 s and always runs on s4. CONFIRMED.
  - Per-leg worker sums are near-equal (e.g. s4 of run 37661644840 had worker loads 248/243 against a wall time of 252 s). So `Run e2e` wall time is about summed time / 2, and file-level summed seconds are a valid balance proxy. That supports D3.
- **Discovery:** there are 49 `e2e/*.spec.ts` files. Removing the 8 `testIgnore` matches leaves 39 discovered specs. 38 of them appear in the baseline reports. The missing one is `hel1351-aggregated-chart-overlay.spec.ts`, added by HEL-1351 (`de1ae5b00`) after the baseline runs.
- **Selftest wiring precedent:** this exists. `package.json` has `check:*:selftest` entries, `.husky/pre-commit` runs them, and `scripts/check-precommit-ci-parity.mjs` exists. So D7 and task 2.2 are implementable as written.
- **CI trigger:** `pull_request: branches: [main]` with no draft filter, so a draft PR runs CI, as D8 and task 2.4 assume.

### Verdict: REFUTE

### Change Requests

1. **D5's weight aggregation is ambiguous, and the design's own numbers show the wrong reading being used.**
   - **What D5 says:** "weight = median across the given CI JSON reports of the file's summed test durations".
   - **Why that breaks:** `--shard` splits *inside* a file whenever a parallel-mode file straddles a shard boundary. In this very baseline, `hel773-top-anchored-mobile-nav-sheet.spec.ts` appears in **both** the s3 and s4 reports of every run.
     - Taking the median per report (per `results.json`) gives 30.5 s.
     - Summing per run first gives 77.7 / 68.6 / 82.9 / 50.5 / 69.9, a median of **69.9 s**.
   - **The design already uses the wrong reading:** its baseline sums (s1 315 / s2 419 / s3 277 / s4 405, total 1416, "~354 per leg") are the per-report reading. The per-run total is about **1455 s (~364 s per leg)**, before adding hel1351.
   - **Required revision:**
     - D5 and the `weights` mode must specify that a file's durations are **summed across all shard reports of the same run first**, and only then take the median across runs.
     - Define how the CLI knows which reports belong to which run, e.g. `weights <runDir>...` where each directory holds that run's per-shard `results.json` files.
     - Correct the design's Context baseline numbers.
     - Add a selftest case where a file split across two shard reports gets its summed, not halved, weight.

2. **Task 1.2 contradicts D5 and cannot be completed as written.**
   - **The conflict:** task 1.2 says to generate the table "from the 5 baseline runs' CI JSON artifacts" and to "verify every discovered spec has a row". But `hel1351-aggregated-chart-overlay.spec.ts` is discovered and appears in none of those 5 runs. D5 also forbids hand-tuning.
   - **Required revision:** pick one of these.
     - (a) Regenerate from >= 5 CI runs that include HEL-1351, e.g. main-push runs at or after `de1ae5b00`, and record the run ids.
     - (b) Change the acceptance signal to "every discovered spec has a row **or** is reported by `run` as defaulted to the median weight", and have `run` print the defaulted files.

   Whichever is chosen, D5, task 1.2 and the "before" table in D8 must name the same run set.

### Non-blocking notes

- **D4's `--list` reporter.** State explicitly that both `--list` calls pass `--reporter=json`, which writes to stdout. If they ran under the CI config reporters, a list-only run would write `test-results/results.json`. That stale file could then be uploaded as the per-test-duration artifact if the real run dies before its reporter flushes.
- **D4's exit code.** If the spawned Playwright child dies by signal, `code` is `null`. Map that to a non-zero exit, so a killed run cannot exit 0.
- **Other HEL-951 comment.** `ci.yml:81-85` (the `check:state-contrast:selftest` comment) also says the guard is gated by "the `e2e` job's `npx playwright test` glob below". Task 1.3 should update that comment along with the step's own.
- **Sample size in the before/after comparison.** "Before" is 25 mixed runs and "after" is >= 5 reruns of one head. That is fine for the ticket, but `profile.md` should also report the before medians over 5 runs, for a like-for-like comparison.
- **AC2 margin.** By my estimate the AC2 target is reachable: balanced summed ~364 s/leg gives a `Run e2e` step of ~185-190 s, plus ~175 s of non-test overhead, for a leg of ~360-370 s. The margin to 390 s does shrink by the two added `--list` passes, so measure and report their cost, as the Risks section already promises.

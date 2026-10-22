## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 2e75962b5bda7157cd80b21e5089980d365aacca. Base resolved live with `resolve-review-base.sh`:
fb684d03b0010e030f80db62f45a2003957344a6. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio
branch=task/e2e-shard-weights-slow-lane/HEL-1667`.

### What I verified (with evidence)

**Weights regenerated with the documented command, not hand-edited (ticket item 1, C2)**
- I ran `node scripts/e2e-shard.mjs weights` over the five run dirs named in the TSV `# Runs:` header (39689629368
  39619844110 39542663790 39507357019 39477341305) in the executor's scratch `artifacts/`. Exit 0, and `diff`
  against the committed `e2e/shard-weights.tsv` is empty (IDENTICAL).
- Provenance via `gh run view`: all five are `CI` / `main` / `push`. 39689629368 is fb684d03b, the current base and
  the first run that contains hel1683. 39619844110 is 4f729eed7 (hel1681). In every one of the five runs, all four
  `e2e (n)` jobs concluded `success`. 39507357019's overall `failure` came from `security` / `ci-complete`, not
  from e2e. Its reports are complete, so accepting it is correct.
- Selection: `gh run list --workflow ci.yml --branch main --event push` shows the four skipped newer runs
  (39615405498, 39583908105, 39560107292, 39540076554). The validator rejects each of them with `unexpected=1`
  (runs-log.txt). The chosen five are therefore the five newest accepted runs, which is design D1.
- `plan 4` now: legs at 2078/2078/2077/2077 s, and no `defaulted` line. Before (plan-before.txt), 9 files were
  defaulted at 43 s.

**The regeneration addresses the measured imbalance**
- I summed the per-test durations in the shard reports of run 39689629368. That run already used the HEL-1668
  weights, and its plan was predicted balanced. Per-shard test sums were 2173 / 1989 / 1625 / 1901 s, and
  Playwright wall times were 1097 / 1001 / 819 / 955 s (spread 278 s).
- The formerly defaulted files really cost much more than 43 s: hel1665 386 s, hel1668-phone-sheet 203 s, hel1656
  168 s, hel1681 130 s, hel1631-draft-mode 129 s, and others. The total weight rose from 6485 to 8310 s.
- So the unbalanced 43 s defaults are a real, measured cause of the spread, and replacing them is the right lever.
- Whether the slowest leg ends up within 2 minutes of the fastest on main (AC1) cannot be measured before merge.
  Per-leg setup and run-to-run variance also contribute: hel1582-sweep-375 went from 339 to 519 s.

**Slow lane (ticket item 2, spec `e2e-slow-lane`, C1)**
- `.github/workflows/e2e-slow.yml` parses (js-yaml). Its triggers are exactly: weekly cron `17 10 * * 1`,
  `workflow_dispatch`, and `pull_request` filtered to its own path. That matches the owner's "weekly" ruling and
  does not run on every PR.
- It has `permissions: contents: read`, a per-ref concurrency group with `cancel-in-progress: false`, and
  `timeout-minutes: 30`.
- I compared its setup line by line with `ci.yml`'s `e2e` job (ci.yml:549-680). It has the same postgres service,
  env block (DB, uploads, ports, Google placeholders, CI-only CONNECTOR_MASTER_KEY/_ID), checkout, java and sbt
  setup, restore-only sbt cache, `e2e-backend.sh start`/`wait`, `npm ci` twice, `playwright install --with-deps
  chromium`, and Vite on 5173.
- The only intended difference is the test step: `HELIO_E2E_SLOW=1 npx playwright test e2e/hel1582-sweep-390.spec.ts
  e2e/hel1582-sweep-768.spec.ts`.
- `playwright.config.ts:151-152` writes `test-results/results.json` when `CI` is set, which Actions always sets.
  The guard step reads that file with `if: always()`.
- No kill patterns: `grep -nE "pgrep|pkill|killall|kill " e2e-slow.yml` has zero hits (rc 1).

**The guard really fails on a skipped gate, using real CI report shapes, not only synthetic ones**
- I ran `node scripts/check-e2e-slow-results.mjs` on the four real shard reports of run 39689629368.
  - Shards 2 and 3 exit 1 and name the skipped tests, including "hel1582-sweep-390.spec.ts > ... MAXIMAL sweep ...
    at 390x844" and the 768 counterpart. This is exactly the failure a broken gate would produce in the slow lane.
  - Shards 1 and 4 exit 0.
- Synthetic cases: expected=0 gives exit 1 ("no test ran"); unexpected=1 gives exit 1; a clean report gives exit 0;
  a missing file gives exit 1 (ENOENT).
- `retries: 0` (playwright.config.ts:139), so a flaky pass cannot hide behind `stats.flaky`.

**Comment-only edits (D6)**
- `git diff` of `e2e/support/hel1582Phone.ts`, both sweep specs and `ci.yml` changes only comments and the
  `test.skip` reason string. The condition `size.width !== 375 && process.env.HELIO_E2E_SLOW !== "1"` is unchanged.
- The README section names the workflow, the schedule, the dispatch command and the env var.

**Local evidence is real, read from scratch logs**
- `sweep-e2e.log` (command in run-sweep.sh: `HELIO_E2E_SLOW=1`, flock, `nice -n 19`, 2 workers): 4 tests ran, both
  MAXIMAL sweeps passed (390x844 in 3.0 m, 768x1024 in 3.0 m), "4 passed (4.2m)", exit=0. The gated tests ran;
  they were not skipped.
- `full-e2e.log`: "3 skipped / 662 passed (44.0m)", exit=0. The 3 skips are the 390/768 MAXIMAL tests plus the
  hel1575 measurement test, all expected without `HELIO_E2E_SLOW`.

**Gates I re-ran myself (all exit 0)**
- `check:e2e-shard:selftest` (15 cases)
- `check:ci-complete-needs`
- `check:ci-sbt-guard`
- `check:cache-cleanup-pr`
- `check:precommit-ci-parity`
- `check:no-credential-leak` (0 violations, including the CI-only key literal in the new workflow)
- `check:repo-integrity`
- `check:openspec`
- `check:e2e-types`
- Prettier `--check` on every changed non-TSV file
- ESLint on the guard script and hel1582Phone.ts

**UI judgment:** not applicable. The diff contains no `frontend/**` changes; the only TS edits are comments and a
test-skip reason string.

**Post-merge ACs:**
- AC1 (spread ≤ 2 min on main) and AC2 (one green slow-lane run on main) can only be measured after merge.
- Tasks 4.1 and 4.2 are correctly left unchecked and owned by the orchestrator. D7 defines an honest pass/fail rule:
  the median spread across ≥ 3 post-merge all-green runs, with "not met" reported rather than rounded up.
- Before merge, the paths-filtered `pull_request` trigger will run the slow lane on this PR as an end-to-end proof
  of the workflow.

### Verdict: CONFIRM

The branch is ready to deliver so that AC1 and AC2 can be measured. Every pre-merge claim I checked against ground
truth held.

### Non-blocking notes
- AC1 risk: legs currently run 15–25 min, with one leg at 24m58s in 39542663790, right at the 25-minute timeout.
  Weights balance test time only, so per-leg setup variance and run-to-run noise may keep the whole-leg spread
  above 120 s even with perfect weights. If 4.2 misses, report it as not met per D7. Do not regenerate repeatedly.
- `scripts/check-e2e-slow-results.mjs` has no committed selftest. Its sensitivity was shown here against real CI
  reports, but nothing in `ci-complete` guards it against regression. A follow-up candidate, not a blocker.
- The slow lane's setup is duplicated from `ci.yml`; the two cross-reference each other in comments. Drift is the
  known risk, and a composite action is the follow-up the design names.

## Context

See proposal.md (Why). Mechanism already in place (HEL-1361, `openspec/specs/e2e-ci-sharding`):
`scripts/e2e-shard.mjs` partitions Playwright-discovered spec files across the 4 `e2e` legs of `.github/workflows/ci.yml`
by weight (LPT); unknown files get the median of known rows. `weights <runDir>...` sums each file's test durations
across one run's 4 reports and takes the median across runs; `validateRunReports` rejects a run unless it has exactly
4 reports with `unexpected == 0` and `flaky == 0`. Reports are uploaded as `playwright-json-shard-<n>` (14-day
retention). Last regeneration: HEL-1668 (d0c600fbf). The slow gate lives in `e2e/support/hel1582Phone.ts:396-401`
(`test.skip(width !== 375 && HELIO_E2E_SLOW !== "1")`, ~3 min per MAXIMAL sweep).

## Goals / Non-Goals

**Goals:** balanced legs (AC: slowest leg within 2 min of fastest on main); a weekly slow lane with proof it ran.
**Non-Goals:** see proposal.md. No behavioural change to `scripts/e2e-shard.mjs`, `ci.yml`, `playwright.config.ts` or any
spec. Allowed: comment-only edits (a `ci.yml` cross-reference comment to `e2e-slow.yml`) and the comment/skip-reason
string updates in D6.

## Decisions

**D1 - Input runs.** Candidate set: the most recent `ci.yml` push runs on `main` (`gh run list --workflow ci.yml
--branch main --event push`), newest first, downloaded with `gh run download <id> -p 'playwright-json-shard-*'` into
the lane scratch dir. A run is used only if the script's own validator accepts it (all 4 legs, no unexpected, no flaky)
- the script is the arbiter, never a hand filter. Use the 5 most recent accepted runs (HEL-1668 used 5), which must
include the newest accepted run that contains `hel1681-refresh-control.spec.ts`; include the `fb684d03b` run (first to
contain `hel1683-regex-main-thread.spec.ts`) if it is accepted. A spec present in no accepted run keeps the median
default and is listed in the PR body. Alternative rejected: PR-branch runs (their spec sets differ from main).
Runs that failed only on hel1631:177 are rejected by the validator; that is intended.

**D2 - Generation is the documented command, output untouched.** `node scripts/e2e-shard.mjs weights <dirs> >
e2e/shard-weights.tsv`. The header's `# Runs:` line records the run ids. Verification: `node scripts/e2e-shard.mjs plan
4` before and after (predicted per-leg load and the `defaulted` list), plus `npm run check:e2e-shard:selftest`.

**D3 - Slow lane = new workflow file `.github/workflows/e2e-slow.yml`, not a `ci.yml` job.** A `ci.yml` job would
have to be in `ci-complete`'s `needs` (ci-required-jobs-guard) and would run on every PR. Triggers:
`schedule: cron '17 10 * * 1'` (weekly, Monday 10:17 UTC; owner ruling "weekly"), `workflow_dispatch`, and
`pull_request` with `paths: ['.github/workflows/e2e-slow.yml']` so the workflow is proven on its own PR before merge
(otherwise its first run is after merge, and `workflow_dispatch` only works once the file is on the default branch).
One job, `timeout-minutes: 30`, `permissions: contents: read`, `concurrency` group per ref with `cancel-in-progress: false` (a weekly run and a manual run must never cancel each
other).
Setup steps mirror the `e2e` job verbatim (postgres service, env block, sbt cache RESTORE only, `scripts/e2e-backend.sh
start/wait`, `npm ci` x2, `npx playwright install --with-deps chromium`, Vite on 5173) with a comment pointing at
`ci.yml` as the source; extracting a composite action would touch `ci.yml` and is out of scope.

**D4 - Selection and the skipped-test guard.** Run `HELIO_E2E_SLOW=1 npx playwright test
e2e/hel1582-sweep-390.spec.ts e2e/hel1582-sweep-768.spec.ts` (whole files: the gated MAXIMAL tests plus their
ungated siblings, ~8-10 min). `CI=true` makes the config write `test-results/results.json`; a following step fails
the job unless `stats.expected > 0`, `stats.skipped == 0`, `stats.unexpected == 0`, naming every skipped test. Upload
the JSON report (always) and the failure report (on failure) like `ci.yml`. Alternative rejected: `--grep MAXIMAL`
(title coupling; ungated siblings are cheap).

**D5 - Measurement.** Before: whole-leg and test-step durations per leg from the GitHub API for the 7 main runs
already in scratch (`before-leg-times.tsv`) plus enough earlier main runs to give >= 5 counting runs (all 4 legs
succeeded). After: this PR's own CI run(s) (pre-merge) and, after merge, main push runs (reported in the hand-back;
AC1 is judged on main). AC2 evidence ("one green run on main"): after merge the orchestrator runs
`gh workflow run e2e-slow.yml --ref main`, waits for it, and records the run id, its conclusion, and the log lines
showing the 390/768 MAXIMAL tests passed (not skipped); the PR-trigger run is pre-merge proof only. The `e2e-ci-sharding` "balance is measured" format (per-leg median and max, whole leg and
test step, imbalance) is used for the report. Its 15 s line was already accepted as unmet by the owner (HEL-1361
delivery note); this ticket's bar is the 2-minute AC and no spec change is made.

**D7 - AC1 pass/fail rule.** Metric: whole-leg wall time (`completedAt - startedAt` of each `e2e (n)` job from the
GitHub API) - the ticket is about timeout headroom, which is whole-leg; test-step time is reported alongside. Sample:
the first N >= 3 post-merge `ci.yml` push runs on main in which all four e2e legs succeeded. Pass: the median of
the per-run spreads (slowest leg minus fastest) is <= 120 s; the maximum spread is reported too. Pre-merge, the PR's
own CI run is a predictor only, never the AC1 verdict. On a miss (median > 120 s, or fewer than 3 counting runs
available at hand-back): report AC1 as NOT met / not yet measured with the data, and hand back to the driver - never
round it to met.

**D6 - Stale gate text.** `e2e/support/hel1582Phone.ts` (comment above the MAXIMAL test and its `test.skip` reason)
and the header comments of `e2e/hel1582-sweep-{390,768}.spec.ts` say "18-minute leg timeout" / "nightly follow-up".
Update only those comment lines and the reason string to point at `.github/workflows/e2e-slow.yml` (weekly +
dispatch). The skip condition itself is unchanged; verified by `git diff` showing only comment/string lines.

## Risks / Trade-offs

- [HEL-1691 lands a prod-build step that shifts hel1631 timings] -> weights go slightly stale for one file; tell the
  driver, re-regenerate in a later ticket if the spread exceeds 2 min. Not blocking.
- [hel1631:177 fails on main] -> PR CI may fail on it alone; per brief, hold and hand back (no rerun approved).
- [Too few accepted runs within 14-day retention] -> use as many as are accepted (>= 3), state the count in the PR.
- [Wall time includes per-leg fixed setup (sbt compile, browser install, DNS retries)] -> weights balance test time
  only; report test-step and whole-leg times separately.
- [Slow-lane setup duplicated from ci.yml drifts] -> comment cross-reference both ways; follow-up candidate: composite
  action.

## Planner Notes

- Self-approved: the `pull_request` paths-filtered trigger (runs only when the workflow file itself changes; ~15
  runner-min per such PR, public repo). Flagged to the driver in the hand-back.
- Self-approved: whole-file selection over title grep (D4).
- `check:ci-sbt-guard` scans only `ci.yml` and three scripts: verify `e2e-slow.yml` separately with a grep for
  `pgrep|pkill|killall|kill ` (zero hits).
- A PR editing `e2e-slow.yml` adds a fifth long job queued against the account-wide concurrent-job cap.
- Owner ruling recorded: weekly schedule (escalation answered 2026-10-21, channel chat).

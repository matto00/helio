## Context

`scripts/e2e-shard.mjs` partitions the discovered Playwright spec files across the 6 `e2e` legs by longest-processing-time-first over per-file weights from `e2e/shard-weights.tsv`. A spec with no row gets the median of the discovered rows (currently 49 s). The job limit is `timeout-minutes: 25` (1500 s). The `e2e-ci-sharding` spec requires the slowest leg at or under 20 minutes (1200 s) on main without raising the limit.

### Measured before (orchestrator, Setup and Planning; GitHub API and CI artifacts, no local runs)

Job wall (`completed_at - started_at`) per leg, 11 recent main push runs (`.concertino/scratch/HEL-1772/main-leg-times.tsv`):

- e2e (6): 1096-1519 s, the slowest leg in 6 of 11 runs; run 44369179186 cancelled at 1519 s.
- Other legs: mostly 820-1100 s; leg 4 went over 1377 s three times (1377, 1396, 1443) and was the slowest leg in 3 runs.
- Fixed per-leg overhead (job wall minus the "Run e2e suite" step): about 150-230 s.

Summed per-test durations per leg from `playwright-json-shard-*` (5 clean main runs 44391395102, 44375091328, 44357733862, 44353873500, 44350387897), against the table's planned load:

- Leg 6: real 1840-2207 s, table load 1529-1563 s.
- Other legs: real 1248-2345 s, table load about 1530-1569 s.
- The largest gaps between real median weight and table weight: `hel1733-draft-outputs-shapes` 358 s vs default 49 s; `hel1684-draft-structural` 334 s vs default 49 s (both on leg 6); `hel1665-home-phone-stability` 674 s vs 386 s; `hel1582-sweep-375` 353 s vs 519 s. 22 discovered specs have no row.

**Cause:** the shard weights are stale. The table predates 22 specs, and the defaulted ones are not near the median. The partition is balanced on paper (1563-1569 s per leg) and unbalanced in fact. It is not a too-tight limit: the evenly divided real load (about 9700 s / 6, about 1620 s summed per leg) maps to about 830 s of test step plus overhead, about 1000-1050 s job wall, well under 1500 s. It is not one slow spec either: the heaviest single spec (`hel1575-dashboard-tabs`, about 750 s summed, about 375 s wall at 2 workers) fits in any leg.

## Goals / Non-Goals

**Goals:**
- The slowest e2e leg on a normal run at or under 1200 s job wall, which leaves at least 300 s (20 %) of headroom under the 1500 s limit, shown on at least three CI runs of the PR.
- Zero defaulted specs on the base head immediately after the regeneration.

**Non-Goals:**
- Raising `timeout-minutes`, or changing `e2e-shard.mjs` partition logic. (The original non-goal "changing the leg count" is superseded by Decision 4, the owner's 7-leg ruling.)
- Automating regeneration or a staleness alarm (candidate follow-up; see Risks).
- Fixing flaky specs (C11 list) or speeding up individual specs.

## Decisions

1. **Regenerate the weight table, using the existing tool unchanged.** Run `node scripts/e2e-shard.mjs weights <runDir>...` over the 5 most recent main push runs where all 6 e2e legs succeeded and every report has `unexpected=0` and `flaky=0` (the tool's `validateRunReports` refuses anything else). Include the run for the base head 80cab1f7a (main run 44403971270, HEL-1671) if it counts, since HEL-1671 grew `hel1608-spine-count-overlap.spec.ts` by about 350 lines. Otherwise use the 5 runs listed in Context. The table header records the run ids.
   - Alternative: raise the limit. Rejected: the measured even load is about 1000-1050 s, so the limit is not the constraint, and the spec forbids raising it to meet the 20-minute bound.
   - Alternative: hand-set the two defaulted heavy specs. Rejected: the table is "never hand-edit"; the other 20 defaulted rows and the drifted rows (hel1665 +288 s, hel1582-sweep-375 -166 s) matter too.
   - Alternative: a better default (a higher percentile). Rejected for this ticket: no fallback value captures a 358 s new spec, and it would change `e2e-shard.mjs` behavior and its selftest.
2. **Placement of new specs (HEL-1743's `e2e/hel1743-insight-refresh.spec.ts`, and any later one).** A spec with no row gets the median of the discovered rows. LPT assigns it in weight order to the least-loaded leg at that point, so one new spec adds only its real cost to a single leg. Every other spec's placement can shift as well, because LPT re-sorts the whole set, so placement shifts are expected and are not a headroom guarantee by themselves. A new spec costing 50-150 s summed (about 25-75 s wall at 2 workers) fits inside the headroom target. A heavy one (over about 300 s summed) should trigger a regeneration after it has run on main. The PR body says this.
3. **Proof is CI-only, collected at Delivery, in the format of the `e2e-ci-sharding` requirement "e2e shard balance is measured in CI".** A weight regeneration is a change to shard assignment, so that requirement applies. CI runs only on `pull_request` and main pushes, so the after set exists only once the PR is open; the orchestrator owns it (tasks.md section 3).
   - **Before set:** the 25 most recent counting main push runs (every e2e leg succeeded and every leg's `playwright-json-shard-*` report is present; cancelled/failed runs, e.g. 44369179186, are listed with the reason and excluded). Per leg: median and max of job wall and "Run e2e suite" step. Imbalance = slowest leg's median test step minus the mean of all legs' median test steps.
   - **After set:** at least 5 counting CI runs of the PR's final head: the first run plus literal `gh run rerun` of the e2e jobs (these are measurement reruns, named as such in the PR, distinct from the C9 one-rerun flake rule). Per-attempt job data via `/actions/runs/{id}/attempts/{n}/jobs` (the default jobs listing returns only the latest attempt). Same per-leg medians, maxima and imbalance, plus each run's mean leg, so a run-wide slowdown is told apart from imbalance. The ticket's own bar (at least three runs) is a subset of this.
   - **Explicitly not met or not applicable, stated in the PR, not hidden:** (a) the "same-window control on heads still using count-based sharding" no longer exists: every head has used weighted sharding since HEL-1361, so there is no control set; (b) the at-most-15 s imbalance line was already accepted as unmet by the owner at HEL-1361 (delivery note in the spec). This change reports the measured after imbalance against it and against the 25-run before imbalance, and claims improvement only if the numbers show it.
   - **The 20-minute requirement** is defined on 5 consecutive all-green main runs. The PR runs are this ticket's proof; the main-branch measurement is a post-merge watch. At Phase 4 the orchestrator reports whatever counting main runs exist after the merge (with run ids), and states that the 5-run main measurement is incomplete if fewer than 5 exist yet. It is not claimed as met until 5 exist.
   - **Out-of-sample check:** the new table's predicted balance is checked against at least one run not used to generate it (the base-head run 44403971270 if it is not in the source set, else 44328417748 or 44325353598), in addition to the in-sample comparison.
   - **Expected outcome, stated up front:** on a normal run, slowest leg about 1000-1100 s job wall. On a run-wide slow run (like 44357733862, mean summed leg about 1908 s) even a balanced partition puts the slowest leg near 1200 s. If an after run exceeds 1200 s, the PR reports the measured table, that run's mean leg, and the cause, rather than raising the limit.

4. **Fold-in: 7 legs (owner ruling 2026-11-18).** Measured on PR #1172 with the regenerated table at 6 legs (run 44410691147, three attempts): slowest leg 1433 / 1395 / 1340 s, mean leg 1118 / 1118 / 1102 s, headroom 67-160 s. Within each leg the two Playwright workers finish within about 120 s of each other (per-worker busy time from the reports), so a leg's wall time is about its summed test time divided by two plus about 180 s of fixed setup. What sets the slowest leg is run-to-run variance in a few heavy specs (hel1665 672-903 s, hel1733 386-579 s, hel1583-glass-nav 190-296 s; hel1608 about 100 s against its 8 s row). No weight table can absorb that, so the per-leg load has to drop.
   - Disclosure: attempt 1 (leg 4, known flake hel1583-glass-nav:554) and attempt 2 (leg 1, known flake hel1573-motion-grid-chart:104) each had a known-flake failure, so under the counting rule only attempt 3 (slowest 1340 s) counts. Playwright runs with `retries: 0` and the failing tests took 9 s and 24 s, so neither failure inflated the wall figures; the premise holds on all three, but only one is a counting attempt.
   - Projection (a projection, not a measurement): at 7 legs the summed load per leg falls by 1/7, so in a slow window the mean leg is about (1110 - 180) x 6/7 + 180, about 980 s, and at the measured slowest-to-mean ratio of 1.22-1.28 the slowest leg is about 1200-1250 s; in a normal window (mean leg about 980 s at 6 legs) about 860 s mean and 1050-1100 s slowest.
   - Changes: `shard: [1, 2, 3, 4, 5, 6, 7]`, `max-parallel: 7`, `DEFAULT_E2E_LEGS = 7`. The selftest's existing assertion (default leg count equals the ci.yml matrix length) is the guard; it must fail red when only one of the two is changed (mutation). The weights table stays: weights are per-file sums over all reports of a run and do not depend on the leg count. A later regeneration from 6-leg runs needs `--legs 6`, which the tool already supports; the README says so.
   - Alternatives: raise `timeout-minutes` (forbidden by the spec for the 20-minute requirement, and it does not reduce wall time); split the heavy specs (follow-up: it needs fresh CI weights for the new files, and the variance is per spec, not only a size problem).
   - Cost: one more runner per CI run (11 parallel jobs with backend's 4, under the account-wide concurrent-job cap that HEL-1288 and HEL-1698 discussed), plus about 180 s of setup per added leg in billed minutes.
5. **Measurement after the fold-in:** whole-run measurement attempts of the PR head after the 7-leg commit (labelled as measurement reruns in the PR) until 5 counting attempts or 7 attempts in total, whichever comes first, and never fewer than 3 attempts (the owner's floor). Five counting attempts is the spec's bar for a change to shard assignment. If the cap of 7 attempts is reached with fewer than 5 counting (the known-flake rate on the 6-leg attempts was 2 of 3), the PR states that the spec's 5-run bar is not met and why. The cap exists because each attempt occupies 11 runners for about 20 minutes, shared with sibling lanes. Counting rule unchanged: an attempt with a known-flake failure does not count; an unlisted unrelated failure gets ONE literal `gh run rerun --job`, and a second parks. Report per attempt the slowest leg, mean leg and headroom under 1500 s, plus per-leg medians and the imbalance for the counting set. If the counting attempts still miss 1200 s, report it and file the heavy-spec follow-up (hel1665, hel1733, hel1583 as heavy, variable specs; hel1608 as a stale row to refresh at the next regeneration); no further escalation (owner ruling).

## Risks / Trade-offs

- [7 legs may still miss 1200 s in a slow window, per the projection] → Owner ruling: report the numbers and file the heavy-spec follow-up, no re-escalation.
- [Account concurrency: 11 parallel jobs] → max-parallel 7 matches the matrix; a queued leg only delays the run, and a delay is visible in the measured job start times.

- [Run-to-run variance: a leg's summed duration varies by up to about ±400 s across runs (e.g. leg 4 at 2345 s in 44357733862)] → Median across 5 runs; report max as well as median; the target keeps 300 s of headroom.
- [The table goes stale again as specs are added] → Documented placement rule (Decision 2); candidate follow-up: a staleness signal or a periodic regeneration, offered in the PR, not built here.
- [HEL-1743 merges first and changes the discovered set] → Its spec just defaults; the partition still verifies exactly-once. If this branch needs a merge from main, the weights stay valid.
- [Weights generated from runs at an older head than the base] → Prefer including the base-head run; any spec changed since is listed in the PR.

## Migration Plan

Rollback reverts `e2e/shard-weights.tsv` and, together in one revert (otherwise the selftest's drift assertion fails), the ci.yml matrix/max-parallel, `DEFAULT_E2E_LEGS`, and the selftest edits. The comment/doc edits revert with them.

## Gate-Chain Implications Checklist

The gate-chain script touched is `scripts/e2e-shard.selftest.mjs` (run by `.husky/pre-commit` via `npm run check:e2e-shard:selftest`); `.husky/pre-commit` itself is unchanged.

- **What does it execute?** Plain `node` on the selftest: pure-function assertions on the partition and weights helpers imported from `scripts/e2e-shard.mjs`, one `readFileSync` + js-yaml parse of `.github/workflows/ci.yml` (the leg-count drift check), and three `spawnSync("node", ["scripts/e2e-shard.mjs", ...])` calls (the `run 5 4` usage refusal and the `weights` CLI cases). None of them starts Playwright, a server or git, and none reads a data source.
- **What environment does it inherit, and from where?** The hook's environment through `npm run`: whatever git exports to a hook (including `GIT_DIR`/`GIT_INDEX_FILE` in a linked worktree) plus npm's. The script reads no environment variable itself and no `.env` file; its child `node` processes inherit the same environment, and none of them runs git, so the git variables have no effect on it. Paths are resolved from `import.meta.url`, not from the cwd.
- **Does it write anything outside its own sandbox?** Only inside one `mkdtempSync(os.tmpdir()/e2e-shard-weights-*)` directory, which the test removes in a `finally` block. It never writes into the repo, the index or any git state.
- **Does it behave differently from a linked worktree than from a main checkout?** No. `ci.yml` and `e2e-shard.mjs` are found relative to the script's own file location, which is the worktree's own copy in both cases, and nothing consults `GIT_DIR`, the cwd or the main checkout.
- **What happens on its first run?** There is no state to initialise: the temp directory is created fresh, and no cache or file from a previous run is read. It fails closed with a named assertion if the ci.yml e2e matrix, `max-parallel` and `DEFAULT_E2E_LEGS` disagree, which is the intended guard. Isolation transcript: `scripts/concertino/test-gate-in-isolation.sh HEL-1772 scripts/e2e-shard.selftest.mjs`.

## Standing Constraints

- [C1] Weights come from CI Playwright JSON reports only: per file, sum durations across all shard reports of one run, then take the median across runs; never hand-tune or hand-add a row.
- [C2] CI timings come from this PR's own runs, one at a time, via the GitHub API; keep full logs for any failing run.
- [C3] (Owner ruling 2026-10-07, ship-restated) AC2 is the balance measure — slowest leg's median Run e2e step minus the mean of the legs' medians; absolute leg time / non-test overhead / install hangs are HEL-1368, never in scope here.
- [C4] Counting rule + fixed sets: a run counts only with all 4 e2e legs success and all 4 reports; the after set is the first 5 counting runs of the regenerated head, never re-measured/substituted to pass; full `gh run rerun` only; a failed bar is reported and escalated.

## 1. Tooling

- [x] 1.1 Write `scripts/e2e-shard.mjs` (`run`, `weights` modes per design D1-D5); verify `node scripts/e2e-shard.mjs run 4 4` prints its assignment and fails with a named file when a partition is broken
- [x] 1.2 Generate `e2e/shard-weights.tsv` with `weights <runDir>...` from the 5 baseline runs named in design.md Context (ids in header); verify every discovered spec has a row or is printed by `run` as defaulted
- [x] 1.3 Replace the `e2e` job's run step in `.github/workflows/ci.yml` (D6), updating its HEL-951 comment and the `ci.yml:81-85` state-contrast comment; verify YAML parses
- [x] 1.4 Rewrite e2e/README.md's "CI runtime: sharding and parallel-mode files" section (file-level LPT from shard-weights.tsv, parallel mode spreads only across a leg's workers, unknown = median of rows for currently discovered files) and document regeneration; verify the command in the doc runs

### Tests

- [x] 2.1 Write `scripts/e2e-shard.selftest.mjs` (D7) with a demonstrated-red mutation; verify it passes and the mutation fails
- [x] 2.2 Wire `check:e2e-shard:selftest` into package.json, `.husky/pre-commit`, and CI per `check-precommit-ci-parity`; verify `npm run check:precommit-ci-parity` passes
- [x] 2.3 Locally (`nice -n 19`, <= 2 workers, own DEV_PORT) dry-check all 4 assignments cover every discovered spec exactly once via `--list`
- [x] 2.4 Push the branch, open a DRAFT PR (title `HEL-1361 ...`), measure >= 5 sequential CI runs of one head (wait for each, then `gh run rerun`) via the GitHub API; write `profile.md` with before (25-run and 5-run) / after per-leg medians and maxima (leg + test step) and run ids

### Post-merge (owner ruling: ship-restated)

- [x] 3.1 Merge origin/main into the branch (no rebase/force-push), resolve conflicts, re-run selftest + `--list` dry-check of all 4 legs; verify the union equals the discovered set incl. hel1331-history-payloads-toggle.spec.ts
- [x] 3.2 Correct profile.md's causal claim (attempt-7 reports, identified by stats.startTime 21:07:33/21:14:08/21:07:16/21:07:43Z: per-leg worker loads within 0.2-6.5%, wall ~= max worker ~= summed/2; residual imbalance = per-leg summed time drifting from the weights, 419/389/443/456 vs ~370) and replace its follow-up section with a reference to HEL-1368; verify the new claim cites those artifact numbers and no "default-mode serial" explanation remains
- [ ] 3.3 (partial: hardening + selftests done; regeneration blocked, see profile.md) Harden `weights` to refuse a runDir without exactly 4 shard reports or with any report whose stats is missing / unexpected > 0 / flaky > 0 (naming runDir + shard) + selftest cases with demonstrated red; push; run sequential full-rerun CI attempts of the merged head until 5 COUNTING runs (C4), downloading each attempt's JSON before the next rerun and recording each report's stats.startTime vs the step started_at; regenerate e2e/shard-weights.tsv from those 5 runDirs (ids/attempts in header); verify every discovered spec has a row
- [ ] 3.4 Commit + push the regenerated table; measure the first 5 counting runs of that head (C4); collect the control per design D8 (first counting attempt of each run on other heads containing the merged origin/main commit = merge's 2nd parent, by `run_started_at` between first and last after attempt, extended back to 5; record the SHA, each head's merge-base --is-ancestor result, and every included/excluded id; inclusion tested on each run's head_sha (fetch PR heads as needed), and control attempts skipped for expired artifacts recorded explicitly); use 25.5 s exactly for line (b); confirm all before-25 runs have 4 JSON artifacts; note the SHALL bar in e2e/README.md's regeneration section; update profile.md with before-25 / control / after imbalance (median-first bar + per-run estimator), per-leg medians+maxima, excluded runs, and three explicit pass/fail lines (<= 15 s, < before-25, < control)

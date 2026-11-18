## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 5caba872074db2c47f3132ab5e2e0c10c3664ea2. Diff base: 497e2b32143a5da2b56f197dff1817195a5904a3 (resolve-review-base.sh, resolved live).
Evaluator scratch: /home/matt/Development/helio/.concertino/scratch/HEL-1758/eval1/

### Phase 1: Spec Review — PASS
Issues: none blocking.

- **AC backend hashFiles.** Root cause is stated only as strongly as the evidence allows (evidence/hashfiles-root-cause.md: "the runner-side evaluation stalled", correlated with but not caused by the 976 MB dependency extract, and not a big-tree walk). Both keys are now computed by `scripts/ci-backend-cache-key.sh` (`git ls-files -s | sha256sum`). That covers ci.yml 255/280/331/341/395 and e2e-setup:49. `grep -rn hashFiles .github/` now finds only the two-literal-path `package-lock` key, which is out of scope as designed. The "after" restore timings depend on PR CI. That is accepted per the brief, and evidence/pending-pr-ci-measurements.md is a sufficient plan: exact `gh api` commands, the D1 (d)(i)-(iv) pass conditions with regexes, the deps/compile equality check against the merge commit, the incremental-compile check, and e2e-slow.
- **AC 660 s deadline.** Verdict: under-provisioned, not hung, with thread-dump and log evidence. Action: weights regenerated from 3 main runs as a mean (714 suites, previously 416). Leg count unchanged (C16). The wall-time model is honestly labelled. It is calibrated on 12 completed legs (max error 8.5 %) but does NOT reproduce the att.1 straggler, so the CI numbers decide. The heaviest predicted leg is 463 s, inside the 480 s budget.
- **AC e2e.**
  - hel1583:25 fixed. Trace-backed cause, forced red (`Received: 0`), green under the same forcing, 40/40 forced and unforced, full file green.
  - hel1665:437 left as a named candidate. The probes recorded are: the trace's font requests, all 200, so HEL-1757 is NOT folded in and the decision is stated; 20/20 baseline; 20/20 under CPU load; and a 12-load per-frame `ch` and face-state sampler. No probe produced the CI signature. Holding the font request would break the spec's own precondition instead, which round 4 forbids. This meets the AC's "record the probes that failed to reproduce it" bar.
  - hel1573:104 left as a named candidate. I checked the trace independently. Panel rows for the chart output answered at about 876.84 s, the lazy `ChartPanel.tsx` was first requested at 877.374 s, and the echarts module chain finished at about 878.26 s, against an expect window of 874.40-879.40 s. The selected dashboard and the data were correct, so this is a time budget, not a wrong state. Fixing it would mean a longer wait, which the AC forbids. The record (trace timeline, forced red with a delayed module, 20/20 natural, full file 4/4) meets the bar.
- Tasks: 1.5 and the CI half of 2.4 are open (pending PR CI, as expected). 3.2/3.3 are open with notes. Everything else is checked and matches the diff.
- No scope creep. No HEL-1742 or HEL-1756 file is in the diff (C15).
- CONSTRAINTS C1-C16: honored in the diff and in this evaluation. No .env read; quoted heredocs; servers stopped with stop-servers.sh; caps of 2 workers, `nice -n 19` and `-J-Xmx3g`; scratch under .concertino/scratch/HEL-1758/; no Flyway migration; 4 legs.

### Phase 2: Code Review — PASS
Gates (fresh, run by the evaluator in WORKTREE_PATH):
- `cd backend && nice -n 19 sbt -J-Xmx3g testFull`: exit 0, 717 suites, 9802 tests, 0 failed, "All tests passed" (eval1/sbt-testFull.log).
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run check:e2e-types`: exit 0. `npm run check:openspec`: clean.
- `npm run check:precommit-ci-parity`: OK. It accepts the new CI-only selftest, which is wired at ci.yml:159. `.husky/**` is untouched.
- `npm test` and `npm --prefix frontend run build`: not run, because no `frontend/**` file changed.
- `npm run selftest:ci-backend-cache-key`: all 13 checks pass. Re-run against the executor's two broken variants: ls-tree gives 10 FAILED, no-project gives 3 FAILED. The red is confirmed independently.
- `npm run selftest:cache-janitor`: passes, including the new transition case.
- Independent pathspec equality: the script's compile pathspecs and the former hashFiles globs (via git ls-files) give an identical 1,678-file list. `:(glob)**/build.sbt` matches exactly `backend/build.sbt`, and so does a `find` over the checkout.
- Local key at HEAD: `deps=3fa29588...`, identical to SBT_NEW_KEY in the janitor selftest and to the executor's recorded value.
- Weights reproducibility: running `gen-test-suite-weights.py` over junit/fresh/{3 runs}/{0..3} reproduces the committed `test-suite-weights.tsv` byte-for-byte.

Code: the script is small and `set -euo pipefail`. An empty input set fails through the command-substitution assignment, and the script validates the 64-hex format before writing `$GITHUB_OUTPUT`. The composite step declares `shell: bash`. The key step comes before the first cache step in each consumer job. No sparse checkout anywhere. The e2e change waits on the real precondition (the shelf's cards) with no added timeout, sleep or retry.

Issues: none blocking.

### Phase 3: UI Review — N/A (product UI unchanged); e2e verification run per C12
No `frontend/**`, ApiRoutes, `schemas/**` or `openspec/specs/**` file changed, so the product UI is untouched. Per C12 the full affected spec files were still run against servers started by start-servers.sh, pinned to 7190/10097 (`DEV_PORT=7190 BACKEND_PORT=10097`; no DEV_PORT-unset warning). The runs used `--workers=2 --retries=0` and `nice -n 19`, concurrently with the sbt run as an added load:
- e2e/hel1583-home-375.spec.ts, full file: 4/4, every run `cardCount: 4`.
- hel1583, full file with `--repeat-each=10` (40 tests): 40/40.
- e2e/hel1665-home-phone-stability.spec.ts and e2e/hel1573-motion-grid-chart.spec.ts, full files: 94/94 passed. Serif `ch40` read 640 every time.
Servers were stopped with stop-servers.sh afterwards, and the worktree is clean.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `backend/project/test-suite-weights.tsv:1`: the header names the generator and the run ids, but not the `extract-fresh-junit.py` pre-step that produces the generator's inputs. design.md says the regeneration command is documented in the file header. Consider adding "inputs filtered by extract-fresh-junit.py" to the header written by `gen-test-suite-weights.py`'s `header()`.
- `e2e/hel1583-home-375.spec.ts:67`: the `Loading dashboards` status check is redundant once four `.home-shelf__item` are present, because DashboardShelf renders the skeleton and the list in mutually exclusive branches. It is harmless. It could be dropped, or its comment could say it guards a future change in the rendering.
- `backend/project/extract-fresh-junit.py:18`: `parse = lambda ...` would read better as a `def`. It is cosmetic.
- hel1573: about 500 ms passes between the last rows answer (876.84 s) and the `ChartPanel.tsx` request (877.37 s), and about 1-2 s between the last chart module and the canvas being visible in the video. If the test fails again, a per-frame mount and size probe of `.chart-panel__canvas` would show whether a deferred ECharts init (size or visibility gating) uses up part of the budget. That part would be fixable without a longer timeout.
- PR body: report the model's failure to reproduce the att.1 straggler prominently. The stressed prediction of 602 s exceeds the 480 s budget, so the per-leg "Compile and test" numbers of the PR run are the real D2 evidence.

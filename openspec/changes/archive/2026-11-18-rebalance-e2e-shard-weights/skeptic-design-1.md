## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, .openspec.yaml (skip_specs: true) at worktree HEAD
80cab1f7aa5559bafc3826cd9072b68ba651c195 (the change dir is untracked). Ground truth: `openspec/specs/e2e-ci-sharding/spec.md`,
`scripts/e2e-shard.mjs`, `e2e/shard-weights.tsv`, `.github/workflows/ci.yml` e2e job, the orchestrator's CI artifacts
under `.concertino/scratch/HEL-1772/art/`, `main-leg-times.tsv`, and GitHub API / job logs.

### What I verified (with evidence)

1. **Cause = stale weights: CONFIRMED.** Re-ran `analyze.mjs` over the 5 artifact runs. Output matches design.md: legs
   planned at 1529-1569 s on paper; real summed leg 6 = 1840-2207 s; `hel1733-draft-outputs-shapes` 358 vs default 49,
   `hel1684-draft-structural` 334 vs 49, `hel1665` 674 vs 386, `hel1582-sweep-375` 353 vs 519; total real 9699 vs table
   9388. The table header confirms the last regeneration used runs 39477341305..39689629368 (HEL-1667, git log
   b23656068).
2. **The fix actually works (simulation, my own script `.concertino/scratch/HEL-1772/skeptic/sim.mjs`).** Partitioning each
   run's real per-file durations with the OLD table reproduces the real per-leg sums exactly (validating the sim), with
   max/mean 1.225-1.361. Partitioning with weights regenerated from the same 5 runs gives max/mean 1.009-1.108
   (in-sample). So weights are the dominant cause; the "not a too-tight limit" and "not one slow spec" arguments hold
   (test-step/summed ratio about 0.51 measured on several legs, so an even ~1620 s summed leg is about 830 s step).
3. **Cancelled run 44369179186 e2e (6)** (job 135030988262, 18:23:30-18:48:49): log shows tests completing steadily up to
   `##[error]The operation was canceled.` at 18:48:42; no hang. Consistent with an overloaded leg, not a stuck test.
4. **Tooling claims:** `validateRunReports` does refuse missing/unexpected/flaky reports (e2e-shard.mjs:176-191);
   `plan` prints defaulted and stale rows (lines 243-244); `check:e2e-shard:selftest` exists in package.json.
5. **1200 s target vs spec:** consistent — the spec's "e2e CI legs keep headroom" requirement bounds the slowest leg at
   20 min (1200 s) job wall without raising `timeout-minutes`.
6. **CI proof at Delivery, orchestrator-owned:** sound in principle — CI runs only on pull_request/main push, so the
   after-measurement cannot exist during Execution.
7. **skip_specs:** justified in the narrow sense that no requirement text changes — but see CR1: the design does not
   account for a requirement this change triggers.
8. **Numbers in main-leg-times.tsv vs design claims:** "e2e (6) the slowest leg in 7 of 11 runs" is wrong — counted
   from the TSV it is 6 of 11 (44391395102, 44375091328, 44369179186, 44353873500, 44328417748, 44288728787; leg 4 is
   slowest in 44357733862/44296217514/44295142906, leg 5 in 44350387897, leg 3 in 44325353598). "Leg 4 reached
   1377-1443 s twice" is three times (1396 in 44357733862 too).

### Verdict: REFUTE

### Change Requests

1. **Address the spec requirement "e2e shard balance is measured in CI" (openspec/specs/e2e-ci-sharding/spec.md).** Its
   trigger is "A change to e2e shard assignment", which regenerating the weight table is (assignment is a function of
   the table). It requires at least five sequential counting CI runs, per-leg median and max (whole leg and test step)
   before and after, and the imbalance metric (slowest leg median test step minus mean of leg medians), against the
   25-run before set. The proposal claims the change "restores compliance" with the existing requirements but cites only
   the weighting and 20-minute requirements, and design Decision 3 / tasks section 3 plan only "at least three" PR runs
   with no imbalance figure. Either (a) commit Delivery to the spec's format (>= 5 counting runs, the imbalance number,
   before and after), or (b) state explicitly in design.md which parts are not met and why (the HEL-1667 precedent did
   exactly this: it used the balance-report format and cited the owner's acceptance of the unmet 15 s line in the
   HEL-1361 delivery note). Silence is the defect; an auditor checking the archived spec will find it.
   Likewise, the 20-minute requirement is defined on "5 consecutive main-branch CI runs"; PR runs alone do not establish
   it. State whether a post-merge main watch is part of the plan (HEL-1698 used one) or that the PR runs are the
   ticket's proof and the main measurement is deferred.
2. **Correct the before-figures in design.md Context (and the premise note they came from):** e2e (6) slowest in 6 of 11
   runs, not 7; leg 4 over 1377 s three times (1377, 1396, 1443), not twice. These figures go into the PR body and the
   ci.yml comment (task 2.1), so they must be right.

### Non-blocking notes

- Variance risk to the 1200 s target is real even with perfect balance: in run 44357733862 the whole run was slow (mean
  summed leg 1908 s); my in-sample sim of the new table still puts the max leg at 2114 s summed there, which maps to
  about 1075 s step + 150-230 s overhead, i.e. right at or above 1200 s. The design's "report rather than raise the
  limit" fallback covers this; consider stating the expected outcome and reporting each run's mean leg alongside the
  max so a run-wide slowdown is distinguishable from imbalance.
- Task 1.3's red-first proof is in-sample (weights and evaluation from the same runs). Adding one held-out run (e.g.
  the base-head run 44403971270 once green, or 44328417748/44325353598) would make it a genuine out-of-sample check.
- Measuring reruns: `GET /runs/{id}/jobs` returns only the latest attempt by default. Use `?filter=all` or
  `/runs/{id}/attempts/{n}/jobs` so each attempt's leg times are captured, and name the measurement reruns in the PR as
  measurement reruns, distinct from the C9 one-rerun flake rule.
- Run 44403971270 (base head) was `in_progress` at review time; tasks 1.1 correctly makes it conditional.
- Decision 2's "planned loads stay within one spec's weight of each other" is the LPT bound on the largest weight
  (hel1575 ~749 s), which is loose; harmless, but do not quote it as a headroom guarantee.

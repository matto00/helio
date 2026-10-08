## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `eb3f508f6c5e5203a48062c818a013ed1caf74c6`, plus the uncommitted revisions to ticket.md, proposal.md,
design.md (D8, D9), tasks.md (C3, group 3) and specs/e2e-ci-sharding/spec.md.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/rebalance-e2e-shard-weights/HEL-1361`.
- **Owner ruling is real.** `.concertino/runs/HEL-1361/events.jsonl` line 17: `escalation.answered`, `answer:"ship-restated"`,
  `answer_source:"human"`, and its id matches the line-16 `escalation.raised`. The context of the raised question gave the owner
  "~26 s before, ~17 s same-window control, ~12 s with this change", so the owner saw the control comparison when ruling.
- **HEL-1368 exists** (Linear, Backlog): "e2e CI legs: cut ~170 s non-test overhead and bound browser-install hangs". It is related to
  HEL-1361 and HEL-1288. Overhead and install work are correctly out of scope.
- **Recomputed the imbalance numbers myself** (median-first estimator: slowest per-leg median `Run e2e` step minus the mean of the
  four medians):
  - before-25 (`scratchpad/before_api.tsv`, 100 rows): medians 190/208/184/228, imbalance **25.5 s**.
  - before-5 (profile): 172/217/140/233, imbalance **42.5 s**.
  - after, attempts 3-7 (profile raw rows): 208/206/229/231, imbalance **12.5 s**.
  - same-window control (`scratchpad/control.tsv`, 8 runs, 30 legs): 236/222/188.5/230.5, imbalance **16.75 s**.
- **How noisy the bar is.**
  - Leave-one-run-out on the 5 after runs gives an imbalance of 18.25 / 21.1 / 16.0 / 8.0 / 3.0 s. With n=5, a single run moves
    the estimate across the 15 s bar in both directions.
  - Drawing 2000 random 5-run subsamples of the before-25 runs, the imbalance has p10/p50/p90 = 16.25 / 27.25 / 38.75 s, and only
    7.4 % of them reach <= 15 s. So "<= 15 s" does separate the change from the historical old-sharding distribution.
  - It does NOT clearly separate the change from the same-window control: 12.5 vs 16.75 s, a 4 s gap that is well inside the
    leave-one-out spread.
  - The per-run estimator (max minus mean within each run, then the median) gives before-25 36.75, control 22.5, after 24.75. On
    that estimator the change is no better than the control.
- **Causal claim (question 3): the orchestrator's correction holds.** I read the four `scratchpad/after/<leg>/results.json` files.
  - Their `stats.startTime` values are 21:07:33 / 21:14:08 / 21:07:16 / 21:07:43Z. Legs 1, 3 and 4 match profile.md's attempt-7
    step timestamps (21:07:28 / 21:07:12 / 21:07:38 step start, plus about 5 s of `--list`). That ties these artifacts to attempt
    7 by their own content.
  - Summed test time per `parallelIndex`:
    - leg 1: 209.7 / 209.2 (wall 212.9)
    - leg 2: 196.1 / 193.3 (wall 198.6)
    - leg 3: 222.1 / 220.6 (wall 225.0)
    - leg 4: 220.9 / 235.2 (wall 240.1)
  - So the two workers in each leg are within 0.2-6.5 %, and wall time is about the max worker, which is about sum/2. A leg of
    default-mode files is not slower than its weight implies. The profile's "default-mode serial files" explanation is refuted.
  - The real residual: per-leg summed time was 419 / 389 / 443 / 456 s against weights of 367 / 370 / 370 / 370. The weights
    under-predicted by 5-23 % in a different amount on each leg, i.e. per-file duration drift and a slower window. Task 3.2's
    replacement claim is supported.
- **Discovered-set change (question 2).** `git diff --name-status 33dcf8fd2 origin/main -- e2e/ playwright.config.ts` shows 49 M and
  3 A. The A entries are `e2e/hel1331-history-payloads-toggle.spec.ts`, `e2e/support/auth.ts` and `e2e/support/evidencePath.ts`.
  There are no deletions or renames, and `playwright.config.ts` is unchanged. D9 correctly says weights from pre-merge runs are
  stale for the merged code.
- **Regeneration tool behaviour.**
  - `scripts/e2e-shard.mjs` `findReports` accepts any number of `<dir>/results.json` (>= 1).
  - `weightsFromRuns` says "Files absent from a run skip it".
  - `ci.yml:586-593` uploads with `if: always()` and `if-no-files-found: ignore`.

  So a run with a leg that hung in install (no artifact) or failed mid-suite (a partial report with timeout-inflated durations)
  is accepted silently. Its files are either under-sampled or skewed, and nothing fails. `retries: 0` (playwright.config.ts:123),
  so retries do not double-count.
- **Artifact overwrite on rerun.** D9's "download each attempt's artifacts immediately, before the next rerun" is the right
  mitigation. But the plan relies on download timing (positional/temporal evidence) to say which attempt a report came from. The
  reports carry their own `stats.startTime`, a self-authenticating substitute that the plan does not use.

### Verdict: REFUTE

The restated AC2 is measurable and is not simply the already-achieved number relabelled: 15 s sits below the p10 of
old-sharding 5-run windows. The D9 direction is right, and so is the task 3.2 correction. What is missing is the rules that
make the second measurement honest given how noisy it is: which runs count, a measurement set fixed in advance, a control
that compares like with like, and one consistent definition of "before" between spec and ticket. Without these, a re-run
until the bar passes, or an incomplete run feeding the weights, would satisfy every artifact as written.

### Change Requests

1. **Define which runs count, for both the D9 regeneration set and the AC2 "after" set (design.md D9 and D8, tasks 3.3/3.4).**
   - A run counts only if all 4 `e2e (N)` legs concluded `success` and all 4 `playwright-json-shard-N/results.json` were
     downloaded.
   - A run with a hung, cancelled or failed leg is recorded in profile.md, its logs kept per C2, and it is excluded from both
     sets.
   - The tool has to enforce this, not just the prose. The `weights` mode accepts any number of reports and skips absent files.
     Either add a check (e.g. `weights` refuses a runDir without exactly the expected reports and names it), or make task 3.3's
     verify step state that each runDir held exactly 4 reports from one attempt.
2. **Authenticate each report to its attempt by content, not download timing (D9, task 3.3).** For each downloaded
   `results.json`, record `stats.startTime` in profile.md beside the attempt's jobs-API `Run e2e` step `started_at`, and check
   they agree (within the `--list` lead, about 5 s). This replaces the "downloaded right after attempt k" ordering argument,
   which rests on mtime and sequence.
3. **Fix the after measurement set before measuring and forbid chasing the bar (D8, task 3.4, C3).** The noise is large:
   leave-one-out on the first measurement spans 3-21 s around a 15 s bar.
   - State that the AC2 "after" set is the first 5 counting runs (per CR1) of the regenerated-table head, in order.
   - No extra reruns may be added or substituted to move the number.
   - If the target is not met, profile.md reports it as not met and the orchestrator escalates. It is not re-measured until it
     passes.
4. **Make the same-window control a defined, compared quantity, not just "reported alongside" (ticket.md AC2, D8, task 3.4).**
   - The before-25 baseline is pre-merge code. After D9, the after runs are post-merge code in which 49 specs changed, so
     "below ~26 s" compares different code in different windows.
   - Define the control: >= 5 green `ci.yml` runs on other heads that contain the merged origin/main e2e changes (at or after
     the origin/main commit merged in task 3.1), still on `--shard` count-based sharding, in the same calendar window as the
     after runs, using the same estimator and the same CR1 counting rule.
   - Report "after imbalance < control imbalance" as an explicit pass/fail line next to the <= 15 s and < before-25 checks.
   - If it fails while the absolute bar passes, profile.md must say plainly that the improvement is not distinguishable from
     the old sharding in the current window, and the orchestrator escalates instead of claiming AC2.
   - Today's numbers (12.5 vs 16.75, inside noise) show why this line is needed.
5. **Align the spec with the ticket's "before" (specs/e2e-ci-sharding/spec.md, requirement "e2e shard balance is measured in
   CI").**
   - The spec says the after imbalance "SHALL be lower than the before imbalance" but never says which before. The before-5
     value (42.5 s) is much easier to beat than the before-25 value (25.5 s) the ticket uses.
   - Name the reference in the spec: the before-25 baseline, plus the same-window control per CR4.
   - Either carry the 15 s ceiling into the spec scenario or state in design.md why the durable spec omits it. Right now
     ticket.md/D8/C3 and the spec state different bars.

### Non-blocking notes

- profile.md should report the per-run imbalance next to the median-first one (before-25 36.75 / control 22.5 / after 24.75
  today). The median-first estimator smooths out within-run noise and flatters the change. Showing both is honest, and the
  median-first estimator stays the bar.
- Task 3.2 says workers are "balanced within 1-7 %". The attempt-7 data gives 0.2-6.5 %; cite the four `stats.startTime`
  values as the attempt-7 identification. Also say that the residual imbalance comes from summed leg time drifting from the
  weights (419/389/443/456 vs ~370), which is the specific thing D9's regeneration is meant to fix.
- Task 3.2 writes its conclusion into its verify step ("verify no default-mode serial explanation remains"). I checked that
  the conclusion holds, so this is fine, but the verify step should check that the new claim is backed by the cited artifact
  numbers, not only that the old text is gone.
- D9 implies at least 10 more full CI runs (5 to regenerate, 5 to measure), plus any hang reruns. That cost is acceptable. Run
  them strictly one at a time with full `gh run rerun` (not `--failed`): a partial rerun leaves earlier-attempt artifacts on
  the untouched legs and mixes attempts within one runDir.

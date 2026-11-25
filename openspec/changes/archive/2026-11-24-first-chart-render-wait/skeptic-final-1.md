## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `a4e4087f8876b54bf3d3ccf5f7bdc750465e9aa0`. Base resolved live with `resolve-review-base.sh`: `7292f77d60ff9f46cf3fc94ce83c1f110b92139f` (origin/main).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/first-chart-render-wait/hel-1651`.
- **Owner rulings are genuine.** `.concertino/runs/HEL-1651/events.jsonl` has three `escalation.answered` events, each with `answer_source: human`: `preload-chart-chunk-earlier`, `preload-plus-state-wait` and `drop-preload-ship-state-wait+fix-172-273-in-pr`.
- **frontend/src is identical to main.** `git diff 7292f77d6 HEAD -- frontend/src` is 0 lines. Outside openspec, the diff touches only `e2e/hel1573-motion-grid-chart.spec.ts`, `e2e/hel1584-motion-surfaces.spec.ts` and `e2e/support/cpuThrottle.ts`. The preload hook and its test were added in 3a59ab2b0/731523c0d and removed in bd43620ac.
- **The throttle helper is inert when unset.** `cpuThrottle.ts` returns before opening any CDP session when the variable is unset, empty or `1`, and throws on a malformed value. It is called in exactly two places in hel1573 (the chart test and the fit test), plus `start()` in hel1584.
- **The Table-cell state wait (question 1).**
  - The canvas assertion is unchanged: same locator, default 5 s.
  - The new wait asserts a different state: seeded cell `500` visible, with a 15 s ceiling.
  - This spec's purpose is the chart entrance and replay behaviour, not first-load performance. The wait makes the canvas's 5 s budget start once the data is on screen, so it now measures chunk load plus ECharts init. It no longer measures the whole startup waterfall. A chart that never renders still fails.
  - The 15 s ceiling belongs to a new wait on a state, not a raised timeout on an existing assertion. It equals the `waitForPanelGrid` helper's existing ceiling.
  - Owner ruling C2 set this exact shape ("Table row or Metric value visible after goto, then the unchanged canvas assertion at default 5 s"), and C3 kept it. So it does not contradict "no bigger timeouts".
- **The `:273` fix (question 2).** I read spec lines 247-282 and the sampling in `e2e/support/motionRecorder.ts:189-240`.
  - The sampler sums rect heights in the display list once per animation frame. A sample taken in the same frame as `setOption`, before zrender flushes, still reads the old line-state list.
  - The fix takes `stale` (the last pre-`setOption` sum) and drops only the leading samples equal to it. Every later sample counts, and the 0.9 bound is unchanged.
  - The new `paintedFrames > 0` assertion stops an empty list from passing vacuously.
  - A genuine replay grows the bars from zero. Its first painted frame differs from the line sum, so it is counted and fails the bound.
  - The mutation evidence agrees:
    - `c3-mutation-273-bars-assertion-alone-6x.txt`: 4/4 red at the bars assertion, ratio 0.12967 in every run. That deterministic value is consistent with a zero-height first replay frame, given the non-bar rects' constant base.
    - `c3-mutation-273-replay-real-6x.txt`: 4/4 red at the span assertion, 294-304 ms.
    - The no-fix red is `c3-final-6x-n10-a.txt`: Received 0.12420785804816227, committed in bd43620ac before the fix commit.
  - `longestSpanMs < 60`, `appliedAnimationDuration === 0` and the `< 1000` guard are untouched. The HEL-1573 C1 guarantee (the entrance runs once per mount; a refresh or recreated view does not replay it) is preserved.
  - My own last 6x run dumped `typeChangeReplay: {longestSpanMs: 0, paintedFrames: 91, barGrowMinRatio: 1}`, so the guard is exercised for real, not vacuously.
- **The `:172` decision (question 3): my own repro attempt, at the current head.**
  - Chart test at 6x, 24 repeats, twice: 48/48 passed.
  - Chart test at 4x, 24 repeats: 24/24 passed.
  - Max entrance span per run, read from the JSON reporter's `chart-entrance-spans.json` attachments:
    - 4x: 287-305 ms.
    - 6x: 273-302 ms.
  - Every run is about 2x clear of the 150 ms lower bound, with a tight spread. The recorded failures (148.4, 131.7, 59.8) are all in evidence committed together with preload code (`green-4x-chart.txt` in 3a59ab2b0; `both-6x-n10.txt` and `final-4x-n5.txt` in 6214dd885).
  - Caveat: that attribution rests on which commit each evidence file landed in, not on a content check.
  - So `:172` is not reproducible without the preload, and the systematic-debugging law forbids a fix with no red. The decision is sound. But C3 literally said "fix :172 in this PR", so the owner must be told (see the notes below).
- **Full spec file, run by me (2 workers, nice -n 19, lane DB, servers on 7083/9990 started at 19:45 for this review):**
  - Unthrottled `--repeat-each=5`: 20/20 passed.
  - `HEL1651_CPU_THROTTLE=6` `--repeat-each=5`: 20/20 passed.
- **Evidence labels (question 4).** I counted the test ids in each file:
  - `c3-fixed-6x-n10-a/b.txt`, `c3-fixed-6x-n40.txt` and `c3-final-6x-n10-b.txt` contain only `spec.ts:105`, so they are chart-test-only.
  - `c3-fixed-full-40.txt` is the whole file (all four tests, 10 each).
  - `probe-findings.md` labels its 6x runs "Chart test", which is accurate.
  - No committed artifact is a whole-file 6x run. The evaluator's whole-file 6x batches are not in the diff.
  - Even a whole-file 6x run throttles only 2 of its 4 tests. The two grid tests (`:23` and `:307`) never call `maybeThrottleCpu`.
  - There is no PR yet (`gh pr list --head` returns `[]`), so the PR body cannot be checked.

Persisted run logs (my runs):
- `/home/matt/Development/helio/.concertino/runs/HEL-1651/evidence/openspec/changes/first-chart-render-wait/evidence/skeptic-final-1/skeptic-final-1x-file-n5.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1651/evidence/openspec/changes/first-chart-render-wait/evidence/skeptic-final-1/skeptic-final-6x-file-n5-a.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1651/evidence/openspec/changes/first-chart-render-wait/evidence/skeptic-final-1/skeptic-final-6x-chart-n24-a.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1651/evidence/openspec/changes/first-chart-render-wait/evidence/skeptic-final-1/skeptic-final-6x-chart-n24-b.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1651/evidence/openspec/changes/first-chart-render-wait/evidence/skeptic-final-1/skeptic-final-4x-chart-n24.txt`

**AC trace:**
- **Probe and root cause:** `probe-findings.md`, plus the CI trace notes in design.md.
- **Red committed as .txt:** `red-6x-chart-test.txt` and `c3-final-6x-n10-a.txt`.
- **State wait, no retries, no raised timeout:** spec :116-123.
- **40/40 and 4x 5/5:** `c3-fixed-full-40.txt` and `c3-fixed-4x-n5.txt`, plus my 20/20 runs.
- **Mutations:** the mutation-a/b files and the two `:273` mutation files.
- **Siblings assessed:** design.md, "Siblings".
- **PR CI passes `:104` without a rerun:** still pending. This is tasks.md 3.5, an orchestrator step.

No UI change, so the design-judgment step does not apply.

### Verdict: CONFIRM

### Non-blocking notes

- **The PR body must tell the owner plainly that `:172` was not changed,** because C3 literally asked for it to be fixed. Say why: 0 failures without the preload in the executor's ~150 runs, plus my 72 runs, with spans of 273-305 ms against the 150 ms bound. Say how to probe it if it reappears: `hel1651-flake-probe.spec.ts.txt`.
- **In the PR body, label the `c3-fixed-6x-*` and `c3-final-6x-n10-b` files as chart-test-only.** For the C3 "file-level 6x 20/20" item, cite either the evaluator's whole-file runs or `skeptic-final-6x-file-n5-a.txt` (20/20). Also state that `HEL1651_CPU_THROTTLE` throttles only the chart and fit tests, never the two grid tests.
- **The `:273` stale-skip has one known blind spot:** a replay whose first painted frame exactly equals the line-state sum would have that one frame skipped. Every later growth frame still counts, so this is negligible.
- **`evaluation-2.md` is untracked in the worktree;** the orchestrator should commit it with the delivery. The copies of my run logs under `evidence/skeptic-final-1/` are also untracked.

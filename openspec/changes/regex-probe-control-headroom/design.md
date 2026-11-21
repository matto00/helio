## Context

`e2e/hel1683-regex-main-thread.spec.ts`, test 1: seeds a static source (2 rows of "a"x28+"!") and a saved
`extractRegex` step with pattern `(x)`, opens `/pipelines/:id`, waits for the sample response + networkidle, then:
installs a `longtask` PerformanceObserver, `fill`s the Pattern textbox with `(a+)!`, waits for "Draft · unsaved changes",
"2 rows" and the matched cell, waits 1500 ms, and asserts (a) no `/draft-preview` request and (b) longest task <= 100 ms.
Recorded control values (69 archived logs under `.concertino/runs/`): 67 x 0.0 ms, 58.0 ms, 74.0 ms (CI run 44855147984).
The evaluator work for 2 tiny cells is microseconds, so any 50+ ms task in this window is NOT the regex. Candidates:
React dev-build re-render of the pipeline page on the edit; a late response landing in the window (the 300 ms debounced
`/analyze` round-trip in PipelineDetailPage, step-preview refresh at 500 ms, run-status polling, the initial page-load
tail that networkidle did not cover); GC. The 1500 ms wait widens the window to all of these.
The same noise shows in the PROBE and OVERRUN windows, which assert the same 100 ms bound: in the run that logged
control 74 ms the probe logged 72.0 ms (`e2e2.log:1947`) although the probe step is declined to the server (so the time
is not the regex); other runs logged probe 57/64 ms and overrun 78 ms twice. All three windows are in scope.
HEL-1697 hit the same class of problem in test 2 (138 ms from a 1.2 MB frame's render) and fixed it by reshaping the
frame (`probe-reshape.md`), not by raising the bound.

## Goals / Non-Goals

**Goals:** know what the control task is made of (evidence, not inference); a control window whose long tasks are
dominated by the client evaluator's own work; <= 60 ms on 5 recorded CI runs with CPU models, or a stated margin+cause;
the probe still red on pre-HEL-1683 code.
**Non-Goals:** raise `LONG_TASK_BOUND_MS`; touch app code; change test 2 beyond shared helpers it already uses.

## Decisions

1. **Attribute first, reshape second.** Before any reshape, measure ALL THREE windows of test 1 (control, probe,
   overrun) with attribution:
   a `long-animation-frame` PerformanceObserver (Chromium) alongside `longtask`, logging per LoAF its duration,
   `blockingDuration`, render/style-layout time (`renderStart`, `styleAndLayoutStart`) and `scripts[]`
   (`invoker`, `sourceURL`/`sourceFunctionName`, `duration`); plus the `/api/` requests/responses that landed in the
   window with timestamps. Local runs are ~0 ms, so reproduce the tail with CDP `Emulation.setCPUThrottlingRate`
   (e.g. 4x and 6x) on the CURRENT spec to get non-zero control tasks to attribute. Record red/attribution output
   as committed `.txt` evidence before changing the frame (C12).
2. **Reshape is chosen from the attribution, by these rules** (the executor records which applies):
   - task is render/re-render of the edit or of a late response unrelated to the evaluator → narrow the window: settle
     every pending request/response (analyze, step preview, polls) and idle before the window opens, and close the
     window at the point the client result is visible plus a short settle, instead of a blanket 1500 ms that admits
     unrelated responses; or reduce what the edit re-renders (e.g. viewport/frame shape) without hiding evaluator work.
   - task is the initial-load tail → wait for a deterministic quiet signal (no long task for N ms) before opening.
   - task is genuinely the evaluator/draft walk → make the frame larger so the evaluator dominates and is measured,
     while staying far under 100 ms (the ticket's "evaluator's own work dominates").
   The same attribution-driven rule is applied to the PROBE and OVERRUN windows: each window opens only after the
   same quiet/settle point and closes at its own deterministic result signal (control: client rows visible; probe:
   the probe's own `/draft-preview` response received, then server live result or budget error visible ("Preview is
   live" alone is not post-fill: it also shows for the control's client result); overrun: budget error visible) plus the same named settle constant.
   The probe and overrun catastrophic/blocking work, if it ran on the client, is synchronous in the input handler of
   the `fill`, so it is always inside a window that opens before the fill; narrowing the tail never hides it.
   Any "settle"/"quiet" duration is a named constant with its rationale in a comment.
   The control must stay a real control: same kind of window and edit mechanism as the probe, client-evaluated
   (no draft-preview), result visible. Any window change applied to the control is applied identically to the probe
   window so the probe's 100 ms assertion is not weakened by a narrower window than before (the probe's catastrophic
   task is synchronous in the input handler, so it falls inside any window that contains the fill).
   > **Superseded by owner ruling margin-note (C10).** No frame or window reshape shipped: a narrowed-window shape was
   > tried and reverted (attribution-new-shape.txt) because the task is the fill's own synchronous React input handler,
   > which any window contains. `LONG_TASK_BOUND_MS` stays 100; the attribution logging is kept; `HEL1808_CPU_THROTTLE` is
   > diagnostic-only and off by default; the PR states the remaining margin and cause (attribution.md).

3. **Diagnostics stay in the log.** The control, probe and overrun `console.log` lines keep their existing prefixes
   (`[HEL-1683 e2e] control|probe|overrun longest long task: ...`) and gain the attribution summary, so CI logs are
   greppable and comparable with the historical values.
4. **CI recording.** Counting runs are this PR's CI runs: the first push's run plus `gh run rerun --job <id>` of the
   e2e leg that runs this spec, at most 6 runs total. Per run: the control value from the job log and the CPU model
   from that leg's `e2e-runner-shard-<n>` artifact, plus the probe and overrun values (or the PR states their margin
   and cause). Because the tail appeared ~2 times in ~70 runs, 5 clean CI runs alone do not prove the fix: the PR
   states that the proof is the attribution plus the throttled local reproduction (old shape vs reshaped). Measurement reruns are named as such in the PR body and are not
   counted as C11 flake reruns.
5. **Mutation.** Red = disable the HEL-1683 decline on the client (a targeted scratch edit, recorded exactly as a
   diff, rather than a literal revert of `fb684d03b`, which conflicts with HEL-1697's later changes) so the
   backtracking-prone pattern is client-evaluated again, run the full spec file, record the probe
   failing with its measured duration, restore. Also a control-side mutation: confirm the reshaped control would still
   catch a slow evaluator (e.g. inject a 150 ms busy loop into the client extractRegex path) so the control is not
   vacuous.

6. **Pass criteria and escalation.** Pass = every window (control, probe, overrun) <= 60 ms at 1x locally (full spec
   file x5) and on the 5 recorded CI runs (or the PR states the margin and cause per window). The 4x/6x throttled runs
   are DIAGNOSTIC: record their values for old shape vs reshaped and what dominates them; they are not a pass gate.
   Escalate to the owner (do not raise the bound) if attribution shows the remaining task is the client evaluator's
   own work or rendering that no test-side reshape can remove, or if any CI-recorded window exceeds 60 ms after the
   reshape with no test-side cause.
   > **Superseded by owner ruling margin-note (C10).** The escalation condition in this decision was met and the owner
   > chose the margin note: the pass criterion is the stated margin and cause (attribution.md), not a reshape; the bound
   > is not raised.

## Risks / Trade-offs

- Narrowing a window can hide work: mitigated by Decision 2's "identical window for probe" rule and the mutations.
- CPU throttling is a proxy for slow CI hosts, not identical; the 5 CI runs are the real measurement.
- If attribution shows the 58/74 ms tasks are the evaluator itself and cannot be reshaped, escalate (bound change is
  the owner's call).

## Planner Notes

- Self-approved: test-only scope, skip_specs, measurement reruns capped at 6 CI runs (driver's AC + 1).
- Branch type `task/` (test tooling).

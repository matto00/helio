# HEL-1814 root cause, per failure

Both CI legs ran on the same runner class: `AMD EPYC 7763 64-Core Processor`, 4 vCPU, 16 GB (HEL-1789 runner record,
artifacts `e2e-runner-shard-3` of run 44876631920 and `e2e-runner-shard-4` of run 44854332613). Evidence:
`.concertino/runs/HEL-1814/evidence/` (CI motion log of the failing test, runner record).

## Failure A: `segmented indicator transform transition` (Expected >= 1, Received 0)

Cause (confirmed by CI trace and local reproduction): a recorder race, not an app bug. `motionRecorder.ts`'s
`transitionrun` handler finds the transition through `target.getAnimations()` at dispatch time. When the renderer main
thread stalls between the style change and the event's dispatch, the transition has already finished and been dropped,
so the handler records nothing. `animationstart` already has a computed-value fallback for this; `transitionrun` had none.

Evidence:
- CI trace of the failing test (run 44876631920): the click on Compact took ~500 ms inside "performing click action"
  (normally ~100 ms), so the renderer was stalled right at the click. The group's `data-indicator` was `ready` at the
  click (frame snapshot `input@call@142`), which refutes H-A1 (click inside the two settle frames).
- The CI motion log for the same click holds ZERO records for `segmented`, including the 160 ms option colour
  transitions (a passing run holds six: transform, width, two colours...). Every transition of that click was lost,
  not just the indicator's, which is the signature of the finished-before-dispatch race and not of a missing CSS rule.
- Local reproduction (`red-a-probe.txt`, probe `probe-a.spec.ts.txt`): with a 500 ms main-thread stall started right
  after the click, `transitionrun` fires with `live: 0` (no CSSTransition left) and the recorder logs 0 transform
  records, while `data-indicator` was `ready` at the click. Intermittent as on CI (2 of 4 and 1 of 8 iterations). No
  stall: 12 of 12 record one. CPU throttling alone (6x and 20x) did not reproduce it: Playwright's own frame-based
  actionability waits keep the click out of the window.
- H-A1 refuted (data-indicator was `ready` at click in every probe row and in the CI trace).

Fix: record from the computed `transition-*` values when no live CSSTransition matches (H-A2 confirmed, so the
fallback is added), and wait (bounded) for `data-indicator="ready"` before the click.

## Failure B: chart `later` span 616 ms (Expected < 600)

Cause (confirmed by local reproduction): wall-clock measurement. The spec measures the unfinished->finished span of
zrender's animation clock between two rAF samples. The span is the 280 ms tween plus every main-thread stall that
lands inside it (the refresh re-renders the panel and re-applies the option in that window), so it exceeds the token
by exactly the stall length. The entrance bound (`entrance < 600`) is measured the same way and is equally exposed.
Not an app bug: the configured durations (`animationDuration` 0 after the entrance, `animationDurationUpdate` 280) are
asserted separately and were correct in the failing run (the failure is only the span).

Evidence:
- Local, no stall, CPU rate 1: refresh span 234 ms. Rate 4: 422 ms. Rate 6: 376 ms. Rate 10: 407 ms (resize span
  stays ~210 ms). The refresh span, which carries the page re-render, grows well past the 280 ms token with load.
- Deterministic: a 450 ms main-thread stall 150 ms after the Refresh click gives `later` = 649 ms and the same
  failure (`red-b-stall.txt`, line 262 `toBeLessThan(600)`, Received 649.3), matching CI's 616.
- A 400 ms stall gives 599 ms (borderline), so the bound is crossed by a ~420 ms stall on a 280 ms tween.

Fix: prove the entrance and update contract from what ECharts configured (read at first chart discovery), keep the
observed `> 150` lower bound, and demote the post-refresh span to a labelled guard with a generous bound.

## Verification summary

- Mutations (each reverted, never committed): A (drop the `ready` indicator transition rule in `motion.css`) red at
  `hel1573-motion-primitives.ts:218` "rail indicator transform transition" (the `ready` wait passed; `red-a-mutation.txt`);
  B (`applyChartMotion` returns the library defaults) red at `hel1573-motion-grid-chart.spec.ts:161` "the entrance was
  configured at the standard token (280ms, not 1000ms)" (`red-b-mutation.txt`).
- 20 of 20 passes per full spec file (`green-20x-*.txt`, two batches of `--repeat-each=10`, 2 workers, nice 19), plus
  3 repeats of both files under CDP CPU throttling 4x (`green-throttled-4x.txt`), plus the other `motionRecorder.ts`
  importers (`green-other-importers.txt`).
- Failure A has no deterministic red on the real spec: the stall race is intermittent (probe 2/4 and 1/8); an injected
  500 ms stall after the click on the real spec did not trip the old recorder in 8 of 8 runs, so no claim is made that the
  recorder fallback is covered by a failing mutation. Its evidence is the CI trace, the CI motion log (0 records, even
  the 160 ms colour transitions) and the probe rows with `live: 0`.

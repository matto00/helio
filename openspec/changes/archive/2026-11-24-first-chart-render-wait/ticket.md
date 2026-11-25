# HEL-1651: hel1573 motion e2e flakes intermittently on main CI (seen at 3d9e5a6cb)

## Description

Reopened 2026-11-22 by owner ruling. HEL-1814 (#1217, 1f8e762b5) fixed the timing assertion in
`e2e/hel1573-motion-grid-chart.spec.ts:104` ("chart: the entrance runs about the standard token ..."). The remaining
failure is the FIRST chart render under load: `await expect(page.locator(".chart-panel__canvas canvas").first()).toBeVisible()`
(line 115), right after `page.goto("/dashboards")`, finds no element within 5 s.

Sightings: main CI run 45496270684 (2026-11-24, head 1370a8d48, an unrelated one-file infra change), job e2e (8)
138807495895, 1 failed / 157 passed; PR #1236 job 137400901902 (e2e (6)); PR run 39608414328 e2e (1) (HEL-1679's lane:
its `seedWorld` POSTs `/run` without awaiting the run). HEL-1658 saw the same canvas wait fail 10/10 at CDP 6x CPU
throttling, and at `hel1584-motion-surfaces` ~:500 once each for its evaluator and skeptic.

Owner instruction (2026-11-23 comment): pull the failing job's log and trace, find what delays the first canvas.
Possibilities: the chart chunk's lazy load, ECharts initialising at zero size (HEL-1647), the seed's un-awaited `/run`,
or a slow CI host (HEL-1789's runner record gives the CPU model). Fix the wait or the app without weakening the assertion.
Original triage rule: get the root cause (systematic-debugging); wait for a settled STATE instead of sampling at a time,
or fix the app if it misbehaves. No retries and no bigger timeouts.

## Acceptance Criteria

- The root cause of the first-canvas delay is identified by a probe (which of the candidate causes is still pending
  when the 5 s lapses), recorded as evidence.
- Shown failing first (under CDP CPU throttling if needed); the red run is committed as `.txt`.
- The fix waits on a state, not a time: no retries, no larger timeouts, the assertion is not weakened. If the seed
  races, the seed awaits the run's terminal state; if the app is slow or misbehaves, the app is fixed.
- `e2e/hel1573-motion-grid-chart.spec.ts` passes 40/40 (2 workers, nice -n 19), plus 5/5 at 4x CPU throttling.
- Mutation: reverting the fix turns it red again.
- Other specs sharing the canvas-wait pattern (e.g. `hel1584-motion-surfaces` near :493/:500, users of `seedWorld`)
  are assessed: fixed only if root cause and fix are identical, otherwise listed.
- The PR's own CI passes `hel1573-motion-grid-chart:104` without a rerun of it.

## Comments (newest first, summarised)

- 2026-11-23 owner: reopened; PR #1236 job e2e (6) 137400901902; different cause from HEL-1814.
- 2026-11-22: closed as fixed by HEL-1814 (superseded by the reopen).
- 2026-10-21: `:103` failed on HEL-1679's PR CI run 39608414328 e2e (1); seedWorld's `/run` not awaited is a likely race.
- 2026-10-18: HEL-1658 — the fixed 5 s canvas wait fails 10/10 at CDP 6x at hel1573 :114, and hel1584 ~:500 failed once
  each for evaluator and skeptic; bigger timeouts ruled out; wait on a state.

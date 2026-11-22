# HEL-1816 production-build margin (spec e2e/hel1683-regex-main-thread.spec.ts, lane DB, 2 workers, nice 19)

## What the observer can report

The probes read a `longtask` PerformanceObserver. The Long Tasks API emits entries only for tasks over 50 ms, and
`longestTask` returns `Math.max(0, ...[])` = 0 for an empty list. So "0.0 ms" in the run output means no long task was
observed (entry list empty, `(tasks: )` in every run), NOT that the longest task took 0 ms. Likewise `frames: none >= 30 ms`
(Long Animation Frames) cannot resolve 30-50 ms frames, because LoAF entries also start at 50 ms.

## Result: margin is a lower bound

| Window | dev baseline | prod run 1 | prod run 2 | prod run 3 | prod, HEL1808_CPU_THROTTLE=4 |
| --- | --- | --- | --- | --- | --- |
| HEL-1683 control | no long task observed | none | none | none | none |
| HEL-1683 probe (declined) | none | none | none | none | none |
| HEL-1683 overrun | none | none | none | none | none |
| HEL-1697 long-cell | none | none | none | none | none |
| HEL-1807 anchored | none | none | none | none | none |

In every window of every run the longest task was under 50 ms, so the margin to the 100 ms bound is **at least 50 ms**; it is
not measured more finely than that. The same reading applies to the dev-build baseline column.

All runs passed (production runs: 4 passed including the guard). LoAF attribution lines print on the production build (see
mutation-M1-run.txt: `scripts=[DIV#root.oninput|app-BGfXG1Qq.js:_h|372]`, hashed chunk name as expected).

The throttled column is `prod-run-throttled.txt`, re-run in cycle 2 with the exact command line as its first line
(`HEL1808_CPU_THROTTLE=4 ...`). The throttle is applied only inside the first test (control/probe/overrun), so the
long-cell and anchored windows of that run were not throttled. The first run's throttled output (cycle 1) did not record its
command line and was replaced by this one.

The dev baseline also showed no long task, so the ticket's dev-noise false-red premise did not reproduce on this host; CI is
where HEL-1808 saw the tail, so the PR's CI `e2e-prod-build` timing (task 4.1) is the real measurement.

## Mutations on the production build (each red, reverted, `git diff --exit-code frontend/src` clean)

- M1 decline disabled: HEL-1683 probe 373.0 ms and HEL-1697 long-cell 561.0 ms (vs ~1.1-1.3 s on the dev build), both failing
  the 100 ms assertion (the probe failed on the bound, not a timeout); HEL-1807 anchored and the rest passed.
- M2 anchored eligibility forced false: only the HEL-1807 test failed, on the no-draft-preview-request assertion (a
  draft-preview request was sent), NOT on the timing bound (no long task observed; the server took the work).

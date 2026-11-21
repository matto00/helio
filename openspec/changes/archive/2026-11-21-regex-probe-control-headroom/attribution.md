# HEL-1808: remaining margin and cause (owner chose the margin note; frame, windows and the 100 ms bound unchanged)

Evidence (same directory): attribution-old-shape.txt, attribution-new-shape.txt (a narrowed-window reshape that was tried
and reverted, see below), final-1x-x5.txt, mutation-decline-disabled.{diff,txt}, mutation-control-busyloop.{diff,txt}.
Local numbers are with the longtask/Long Animation Frame reporting floor of 50 ms, so `0.0` means "under 50 ms".

## Cause
Every shipped-shape control/probe/overrun long task reproduced under CDP CPU throttling (`HEL1808_CPU_THROTTLE`, diagnostic only; unset
on CI, which sets nothing) is attributed by Long Animation Frame to the fill's own synchronous input handler
(`DIV#root.oninput` -> `dispatchDiscreteEvent`, 41-97 ms of script at 4x/6x, render/style-layout 0-5 ms). That is what was
measured: the handler as a whole. The split inside it between React dev-build rendering, the client draft walk and the
evaluator was NOT measured (a control-vs-probe handler comparison is confounded: in the committed 6x shipped-shape runs
the probe handler costs more than the control's, and paired deltas across all throttled runs range -11..+48 ms; the one
red in the evidence, a 119 ms overrun in the reverted new shape at 4x, was a React render of a late response). The control window makes no API call, so no
response render is in it. A minority of tasks are React renders of late responses (debounced preview, the probe's own
draft-preview response).

## Why no reshape
Narrowing the windows (1 s quiet before, result signal + 300 ms after) did not reduce the control task (4x: 75/99/72 ms
vs 68/72/62 old; 6x: 98/87/82 vs 55/58/0) because the handler is inside any window that contains the fill. A larger frame
would raise it. No test-side change removes it.

## Margin
- 1x local, full spec x5, final tree: control, probe and overrun 0.0 ms (under the 50 ms floor) in all five runs.
- Throttled (diagnostic, not a gate): old shape 4x control 62-72 ms, 6x control 0-58 ms; probe and overrun 50-85 ms.
- Headroom against the 100 ms bound: CI control 74 ms -> 26 ms, CI probe 72 ms -> 28 ms (run 44855147984), throttled
  shipped-shape worst overrun 85 ms -> 15 ms.
- Reading of the CI 74/72 ms pair (INFERENCE, not proven): either the handler alone on a slow host, or a shared host
  stall/GC on top of it. The probe's step is declined to the server (no evaluator), which is why a stall is plausible.
- On a host ~1.4x slower than usual (HEL-1793) an occasional red remains possible. It would not mean a regex regression:
  the HEL-1683 mutation goes red at 491 ms and 1132 ms, far above this noise.

## CI runs (HEL-1808 PR)
Recorded after this change was archived (adding them here would trigger another CI run): see the PR body and
`.concertino/runs/HEL-1808/evidence/ci-runs.md` in the main checkout, per run control / probe / overrun and the leg's CPU
model from the `e2e-runner-shard-<n>` artifact.

## Mutations (full spec file, 2 workers)
- Decline disabled (`isBacktrackBounded` check and `regexInputCost` budget off): probe red at 491 ms, long-cell probe red
  at 1132 ms. Diff in mutation-decline-disabled.diff.
- 150 ms busy loop per row in the client extractRegex: control red at 1209 ms (the walk runs it several times). Diff in
  mutation-control-busyloop.diff.

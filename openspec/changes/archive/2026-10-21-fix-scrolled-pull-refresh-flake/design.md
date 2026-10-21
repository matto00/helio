## Context

See proposal.md (Why). Evidence lives in `/home/matt/Development/helio/.concertino/scratch/HEL-1682/`:
CI logs `job-118770310054.log`, `job-118952871693.log`; extracted traces `art1-x/`, `art2-x/`; planning probes
`probe-busy-chain.log`, `probe-busy-none.log`, `probe-busy-raf2.log`, `probe2-r6-none.log`, `copy-r6.log`,
`copy-r12.log`; the probe sources `zz-probe-hel1682.spec.ts` and `zz-copy-hel1682.spec.ts` (a copy of the spec with a
`PROBE_THROTTLE` beforeEach calling CDP `Emulation.setCPUThrottlingRate`).

CI facts (traces): run 39463951430 start 246 (clamped), polled 270 for 5 s; run 39517434455 start 300, polled 300 for
5 s. Both: 16 `Input.dispatchTouchEvent` calls of 26-50 ms each, and `scrollTop` never decreased.

Probe facts (local, unmodified test sequence plus logging listeners on `document`, passive):
- STUCK runs: touchstart target `span.ui-data-grid__resize-handle` (`touch-action: none`) in the Table panel header;
  every touchmove `cancelable=true, defaultPrevented=false`; no `scroll` event. 1/8 runs in `probe-busy-chain.log`.
- SCROLLED runs: target a `td` or a `th` (no handle); first touchmove cancelable, the rest `cancelable=false` (native
  pan started); `scrollTop` falls by about 125-140.
- Layout is not settled when the test sets `scrollTop`: within one run `scrollTop` moves 300 -> 238, 246 -> 270,
  300 -> 400 with no touch (scroll clamping and scroll anchoring as card heights finish), so the element under the
  fixed point `(width/2, 300)` varies between runs.
- Refuted hypothesis: "the programmatic `scrollTop` is not yet committed to the compositor when the touch starts".
  Waiting two animation frames after setting `scrollTop` did not remove STUCK (`probe-busy-raf2.log`: 2/6 STUCK, all
  on 375).
- Pure CDP throttle did not reproduce on the unmodified test locally: 6x 30/30, 12x 20/20 green (`copy-r6.log`,
  `copy-r12.log`); 20x times out in setup. A 400 ms main-thread stall injected right after the `scrollTop` write
  (`PROBE_BUSY=400`) gave 2/6 and 1/8 STUCK.

The pull gesture never engaged in any run (touchstart ineligible: `scroller.scrollTop > 0`; no indicator).

## Goals / Non-Goals

**Goals:** the test's drag always starts on natively pannable content; it samples `start` only from settled state;
an unmet precondition fails with a message naming the element under the finger.

**Non-Goals:** app changes; the resize handle's `touch-action`; other tests in the file (the "upward drag" test already
starts on `cardPoint`, the first card, a plain metric card).

## Decisions

1. **Touch point from layout, not a constant.** Pick a point inside a markdown Notes card's content box that is
   inside the viewport after the scroll, with room for the 150 px drag above the bottom nav. Alternative rejected:
   keep `(width/2, 300)` and only wait for settle — settled layout would be deterministic but could still be
   deterministically on the handle at some viewport/font, and the test would encode an accident.
2. **Settled-state waits, never sleeps.** Before scrolling: `expect.poll` until the scroller's `scrollHeight` and the
   chosen card's `getBoundingClientRect().top` are identical across consecutive animation frames (sample in-page over
   N rAFs). After writing `scrollTop`: `expect.poll` until `scrollTop` is stable across consecutive frames and > 100;
   `start` is that settled value. Default `expect.poll` timeout only (no bigger timeouts, no retries).
3. **Precondition guard.** At the touch point, `document.elementFromPoint` must be inside the Notes card, every element
   from it up to `.app-content` must have computed `touch-action: auto` and must not be a scroller (`overflow-y` auto/scroll with `scrollHeight > clientHeight`, or `scrollTop > 0`); the check runs immediately before `touchStart` with nothing awaited between; on failure the assertion
   message carries the hit chain. Must be shown red by mutation (point it at `.ui-data-grid__resize-handle`).
4. **Reproduction red (AC "shown failing first").** The executor first tries natural red on the unmodified spec under
   CPU throttle via the scratch copy (`zz-copy-hel1682.spec.ts`, whole file or `-g "scrolled page"`, 2 workers,
   rates such as 4x/6x/8x, `--repeat-each` >= 20). If none reproduces, the reproducing condition is CDP throttle plus
   the injected main-thread stall after the `scrollTop` write (`PROBE_BUSY=400`, the same mechanism as CI contention
   reshuffling layout at that moment), which the planning probe showed red; the fixed test must then be 40/40 green
   under exactly that condition: 40 passes per size (375 and 390), the condition always including a real CDP throttle rate. Whatever condition is used is stated verbatim in the PR body.
5. **Harness stays out of the repo.** Throttle and stall injection live only in scratch copies; the committed spec
   gains no env-gated hooks.

## Risks / Trade-offs

- [The Notes card may not be in the viewport at scrollTop 300 at 375/390] -> choose the card by geometry at runtime and
  assert it; if none qualifies, adjust the scroll target, never the drag distance semantics.
- [A stalled condition is a proxy for CI load] -> red is also attempted with pure throttle first; the proxy is
  disclosed; the guard makes any residual geometric cause fail loudly rather than flake.

## Planner Notes

- Self-approved: test-only fix, no app change (the gesture never engaged; probe-confirmed). Follow-up candidate for the
  hand-back, not filed: on phone dashboards a drag starting on a Table header column-resize handle cannot pan the page.

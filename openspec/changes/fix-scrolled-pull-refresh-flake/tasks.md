## Standing Constraints

- [C1] Every red run of the unmodified test logs the touchstart target chain, so each STUCK run names its element.
- [C2] The red and the 40/40 green both run under a real CDP throttle rate (>1x); a stall hook, if used, is added on top of the throttle and placed right after the scrollTop write.
- [C3] "40/40" means 40 passes per size (375 and 390), i.e. --repeat-each=40 over both sizes, 80 runs, 0 failures.
- [C4] The precondition guard rejects a nested scroller (computed overflow-y auto/scroll with scrollHeight > clientHeight, or scrollTop > 0) and any touch-action other than auto, and it is evaluated immediately before touchStart with nothing awaited in between.

## 1. Reproduce

### Tests
- [x] 1.1 Red on the unmodified test: run the scratch copy under CPU throttle (natural first, then throttle + PROBE_BUSY=400 per design D4) with `--repeat-each`, `--trace retain-on-failure`, 2 workers, `nice -n 19`, under the e2e lock; save logs to scratch and verify at least one failure at the `toBeLessThan(start)` poll with a resize-handle touch target
- [x] 1.2 Record the reproducing condition (rate, stall, repeat count, red count) in scratch `repro.md` and verify it names the touch-target evidence

## 2. Fix

### Tests
- [x] 2.1 Rewrite the "a scrolled page scrolls natively upward and never engages" test per design D1-D3 (settled-layout wait, settled scrollTop, Notes-card touch point, precondition guard) and verify `npm run check:e2e-types` passes
- [x] 2.2 Show the guard red by mutation (touch point forced onto `.ui-data-grid__resize-handle`), revert, and save the red output to scratch
- [x] 2.3 Verify 40/40 green for the fixed test (both sizes) under the reproducing condition from 1.2, and the whole hel1656 file green unthrottled; save logs to scratch
- [x] 2.4 Run lint/format/typecheck and the frontend CI script checks locally and verify all pass

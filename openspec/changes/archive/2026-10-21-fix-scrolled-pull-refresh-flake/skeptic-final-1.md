## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 264d50c02f028e2431094eb368a75285d692ec62. Base resolved live with `resolve-review-base.sh` (main/origin):
e88acadb9a833755cf15e6e6b6e49d3ae97f5aa7. The diff touches only `e2e/hel1656-pull-to-refresh.spec.ts` (+105/-3) and the change
artifacts. There are no app, schema or contract changes.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/pull-refresh-scrolled-flake/HEL-1682`.
- **Red on the unmodified test (fresh, my own run):**
  - Setup: I diffed the executor's `zz-red-hel1682.spec.ts` against `git show e88acadb9:e2e/hel1656-pull-to-refresh.spec.ts`.
    The only additions are:
    - the throttle hooks (`PROBE_LATE` puts `setCPUThrottlingRate` right after `client(page)`);
    - a passive touchstart logger;
    - the 400 ms stall right after the `scrollTop` write;
    - a 30 x 100 ms pre-sampling loop, which only lengthens the wait.

    The test's own sequence, touch point `(width/2, 300)` and `toBeLessThan(start)` assertion are unchanged.
  - Run: I copied it to `e2e/zz-skred-hel1682.spec.ts` and ran it under the e2e lock with `nice -n 19`, 2 workers,
    `--trace retain-on-failure`, `--repeat-each=40 -g "scrolled page"`, `PROBE_LATE=1 PROBE_THROTTLE=4 PROBE_BUSY=400`.
    I removed the file afterwards.
  - Result: **4 failed / 76 passed, exit=1**. All 4 are at 375, and all 4 STUCK lines name
    `span.ui-data-grid__resize-handle[ta=none]<th.ui-data-grid__th--pin-reserve<...`.
  - Three of the four show `start=246 end=270`. That is the same signature as the CI trace for run 39463951430 (start 246,
    polled 270).
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1682/skeptic-red.log`.
  - This independently reproduces the executor's red (`red-late-r4-busy400.log`, 2/40 failed with the same target).
- **Green under the same condition (fresh, my own run):**
  - Setup: I diffed `zz-fixed-hel1682.spec.ts` against the committed spec. The only differences are the throttle line
    (same position, after `client(page)`) and the 400 ms stall (right after the `scrollTop` write).
  - Run: a copy of it under the same lock, workers, trace and `--repeat-each=40` settings.
  - Result: **80 passed, exit=0, 40 at 375 and 40 at 390** (counted from the `✓` lines).
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1682/skeptic-green.log`.
  - Statistics: the unfixed test failed 4 of 40 runs at 375 under this condition, so 40 straight passes at 375 would happen
    by chance about 1.5% of the time (0.9^40). Adding the executor's and evaluator's independent 80/80 runs makes chance
    negligible. The AC "shown failing first, then passes 40/40 under throttle" is met (C2, C3).
- **Root cause is probe-confirmed and matches the fix:**
  - The fixed point `(width/2, 300)` lands on whatever the unsettled layout puts there. When that is a Table header resize
    handle (`touch-action: none`), the native pan never starts.
  - The gesture never engaged, so the ticket's "fix the app instead" branch does not apply.
  - The fix picks the touch point from layout, on a Notes card, which removes the dependence on a layout accident.
- **Waits are state waits, not sleeps:**
  - Both new waits are `expect.poll` over an in-page check that resolves only when values hold across 6 consecutive rAFs.
  - The first wait checks `scrollHeight` and the Notes card's top. The second checks `scrollTop`, and it must also be > 100.
  - Both use the default poll timeout. There is no `waitForTimeout`, no retry and no timeout increase in the diff.
- **The guard can fail:**
  - Executor mutation (`zz-mut-hel1682.spec.ts`; I diffed it: the touch point is forced onto `.ui-data-grid__resize-handle`):
    `mutation.log` shows 4 failed.
  - The failure message carries the full hit chain plus `"not inside a Notes card"` and
    `"span.ui-data-grid__resize-handle touch-action none"`. So both the Notes-card branch and the touch-action branch are
    shown red.
  - The evaluator's mutation showed the nested-scroller branch red (`eval1-mut-scroller.log`).
  - The guard runs right before `dragDown`, whose first send is `touchStart`. Nothing else is awaited in between (C4).
- **Gates (fresh):**
  - `npm run check:e2e-types` exit 0.
  - `prettier --check` on the spec: clean.
  - `eslint --max-warnings=0` on the spec: exit 0.
  - The executor's `file-unthrottled.log` shows the whole hel1656 file 17/17 green.
- **Hygiene:** no `zz-*` files are left in `e2e/`. `git status` shows only the evaluator's untracked `evaluation-1.md`.
  No env-gated hooks were committed (D5).
- **UI review:** N/A, because no `frontend/**` changed.
- **Gate-defect check:** no report discloses unsound evidence mtimes, and no conclusion here rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes

- After the settled-scroll poll, `start` is read again in a separate `evaluate`. Using the value the poll already returned
  would remove that window. In practice it is harmless, because the poll required the value to hold for 6 frames.
- The red is a proxy: CDP throttle 4x applied mid-test, plus a 400 ms main-thread stall after the `scrollTop` write. Pure
  throttling stayed green. The PR body should state the condition verbatim (design D4). It reproduces the CI 246 -> 270
  signature exactly, which supports it as the right proxy.
- Real product follow-up, worth filing: on phone dashboards, a drag that starts on a Table header column-resize handle
  (`touch-action: none`) cannot pan the page.

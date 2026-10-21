## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD e88acadb9a833755cf15e6e6b6e49d3ae97f5aa7 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/pull-refresh-scrolled-flake/HEL-1682`.
- **Test under review** (`e2e/hel1656-pull-to-refresh.spec.ts:221-235`): it writes `scrollTop = 300`, reads `start` once
  with no settle, and drags from the fixed point `(size.width / 2, 300)`. This matches the design's description.
- **CI failures are both at 375.** `job-118952871693.log`: `✘ ... at 375 › a scrolled page ...`, `Expected: < 300`,
  `Received: 300`; the 390 run of the same test passed in that shard. The art1 trace (`art1-x/test.trace`) shows 16
  `Input.dispatchTouchEvent` calls, `start` = 246, and every poll after that compared against 246 for about 5 s.
- **CI geometry backs the root cause.** I looked at the art1 screencast frame
  `art1-x/resources/page@ced17da0...-1792517195330.jpeg` (375x812, shown at 0.739 scale), captured during the drag.
  At CSS x = 187.5 the frame shows the boundary between the `amount` and `region` header columns of the Table panel,
  and y = 300 is at the top edge of the header row. The resize handle sits exactly at that column edge: it is
  `position: absolute; top:0; bottom:0; right:0; width: var(--space-2); transform: translateX(50%); touch-action: none`
  (`frontend/src/shared/ui/DataGrid.css:321-331`). The horizontal position is the same in every run of a given size,
  which explains why only 375 fails. The vertical position depends on the unsettled `scrollTop`, which explains why
  the failure is intermittent.
- **Probe logs.** In `probe-busy-chain.log` the STUCK run (375, start 300) has
  `tgt=span.ui-data-grid__resize-handle[ta=none]<th.ui-data-grid__th--pin-reserve<...`, and every touchmove is
  `c=true p=false` with no scroll event. The SCROLLED runs have `tgt=td...`: the first touchmove is cancelable, then
  `c=false` once the native pan starts. Every STUCK run in `probe-busy-none.log` and `probe-busy-raf2.log` (4 runs) is
  at 375. `probe-busy-raf2.log` has 2/6 STUCK, which supports refuting the "compositor not committed" hypothesis.
  `copy-r6.log` shows 30 passed, `copy-r12.log` 20 passed, and `copy-r20.log` 10 failed (setup timeouts per design),
  all consistent with the design's claims.
- **No engagement, so no app fix is needed.** `usePullToRefresh.ts:143,162,192,204` makes `scrollTop > 0` ineligible,
  and the listener calls `preventDefault` only when engaged. The STUCK runs log `p=false` on every move. The ticket's
  "fix the app if it engages" branch therefore does not apply.
- **The proposed touch target is pannable.** `MobilePanelStack.css` sets `.mobile-panel-stack__item--markdown
  .markdown-panel { height:auto; overflow:visible }`, so there is no nested scroller on mobile. The Table/output
  `.panel-content` is the only capped scroller (`max-height: 60dvh; overflow-y: auto`). In the CI frame, Notes 1 is
  in the viewport below the Table panel at scrollTop of about 250-300, with room above the bottom nav.
- **Artifacts check.** No TODO/TBD. Tasks 1.1-2.4 cover AC "failing first" (1.x) and "40/40 under throttle" (2.3).
  Scope is test-only and matches the ticket. The spec has no API/schema impact, so no delta is needed
  (`skip_specs: true`). No retries or larger timeouts are introduced (D2 uses only the default `expect.poll`
  timeout).

### Verdict: CONFIRM

### Non-blocking notes

1. **The handle-target evidence is a sample of one.** Only `probe-busy-chain.log` logged the target, so the claim
   "STUCK runs: target is the resize handle" rests on 1 logged STUCK run. The other 4 STUCK runs did not log a
   target. The CI frame geometry and the 375-only pattern corroborate it, but in the PR body the executor's red runs
   (task 1.1) should log the touch target of every STUCK run, so the root cause rests on more than one sample.
2. **The planning red was not under throttle.** Every planning red was `rate=1` plus `PROBE_BUSY=400` in
   `zz-probe-hel1682.spec.ts`. None used throttle plus stall, and `zz-copy-hel1682.spec.ts` only supports
   `PROBE_THROTTLE` (no `PROBE_BUSY`). Task 1.1 has to add the stall hook to the scratch copy, at the same point
   (right after the `scrollTop` write). The AC says "under throttle", so the green 40/40 condition must include a CDP
   throttle rate as well as the stall, as D4 states.
3. **What "40/40" counts is ambiguous.** Task 2.3 says "both sizes": state whether it is 40 total
   (`--repeat-each 20` x 2 sizes) or 40 per size. Either is defensible; 40 per size is the stronger claim.
4. **The guard check is weaker than the proposal promises.** D3 checks `scrollTop === 0` on the hit chain, which does
   not detect a nested scroller sitting at its top. The proposal promises "no nested scroller". Consider also checking
   `overflow-y` not in `auto|scroll` with `scrollHeight > clientHeight` (or `overscroll-behavior`) on the chain, so
   the guard matches the proposal's wording.
5. **The guard runs before the touch.** `elementFromPoint` is checked before `touchStart`, so a layout shift between
   the two could still move the target. The settle waits make this unlikely. Run the guard immediately before the
   touchStart, with no awaits in between other than the CDP call.
6. **A follow-up is worth filing.** On phone dashboards, a vertical drag that starts on a Table header column-resize
   handle cannot pan the page (`touch-action: none` on an 8 px band at every column edge). This is a real user-facing
   papercut. File it rather than only mentioning it.

## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 264d50c02f028e2431094eb368a75285d692ec62 (base e88acadb9a833755cf15e6e6b6e49d3ae97f5aa7, resolved live).
Diff: `e2e/hel1656-pull-to-refresh.spec.ts` (+105/-3) plus change artifacts only.

### Phase 1: Spec Review — PASS
Issues: none.

- AC "shown failing first, then passes 40/40 under throttle":
  - Red: `red-late-r4-busy400.log` shows 2 failed / 38 passed / exit=1 for the unmodified test sequence. The failure is at the
    original `toBeLessThan(start)` poll (`Expected: < 246, Received: 270`), both at 375. Both STUCK lines name
    `span.ui-data-grid__resize-handle[ta=none]<th.ui-data-grid__th--pin-reserve<...`. `repro.md` matches the log.
  - The red copy adds a 30 x 100 ms sampling loop before the original poll. That is extra instrumentation; it does not
    weaken the test, and the failure is still raised by the original assertion.
  - Green (executor): `fixed-green80.log` shows 80 passed, exit=0, with 40 runs at 375 and 40 at 390 (counted from the
    `✓` lines).
  - Green (mine, fresh): see Phase 2.
- C1: every red-copy run logs the touchstart target chain. Counts: red-r6 40/40, red-r4-busy400 40/40, red-r2-busy400
  80/80, red-r3-busy1000 60/60, red-late-r4-busy400 40/40 `TOUCHSTART=` lines.
- C2: is the throttle placed the same way in red and green? Yes. In `zz-red` with `PROBE_LATE=1`, the CDP
  `setCPUThrottlingRate` call comes immediately after `const cdp = await client(page)` and before the `scrollTop = 300`
  write. In `zz-fixed`, the throttle call is at the same point in the shared sequence: after `client(page)` and before
  everything the fix adds. The only code between it and the `scrollTop` write is the new settled-layout wait, which is
  part of the fix and runs throttled. So the green condition is at least as strict as the red one. In both copies the
  400 ms stall comes right after the `scrollTop` write and is stacked on the throttle. `zz-fixed` uses rate 4 and busy 400
  by default, which matches the red condition. A diff of `zz-fixed` against the committed spec shows the only
  differences are these two hook lines.
- C3: 80 runs, 40 per size, 0 failures (both the executor's run and mine).
- C4: `touchBlockers` rejects these cases:
  - computed `touch-action` other than `auto`;
  - `overflow-y` auto/scroll with `scrollHeight > clientHeight`;
  - `scrollTop > 0`;
  - a hit that is not inside a Notes card.

  Its result is checked with a synchronous `expect`, and `dragDown`'s first send is `touchStart`. Nothing else is
  awaited in between.
- The tasks are all marked done and match the diff. No scope creep: test-only, no env-gated hooks committed (design D5).
  `skip_specs: true` is appropriate.

### Phase 2: Code Review — PASS
Issues: none blocking.

Fresh gate runs in WORKTREE_PATH: `npm run lint` exit 0, `npm run format:check` exit 0, `npm run check:e2e-types`
exit 0. No `frontend/**` or `backend/**` files changed, so jest, the frontend build and sbt are not triggered.

Fresh reproducing-condition run (mine). I made a scratch copy of the committed spec with only a throttle hook (rate 4,
placed after `client(page)`, failing if it is not > 1) and a 400 ms stall right after the `scrollTop` write. I ran it
under the e2e lock with `nice -n 19`, 2 workers, `--trace retain-on-failure` and `--repeat-each=40 -g "scrolled page"`.
Result: 80 passed (4.5 m), exit 0. Breakdown:

- 375: 33 runs landed on `article.panel-grid-card` inside the markdown item, 1 on `div.markdown-panel`, 6 on `p` with
  start=400.
- 390: 36 runs landed on `p` in `.markdown-panel`, 4 on `div.markdown-panel`.

Every run's touch chain was a Notes card, and `scrollTop` fell after the drag.

Guard mutations:
- Executor (touch-action branch): `mutation.log` shows 4 failed. The touch was forced onto the resize handle, and the
  message names the chain plus `span.ui-data-grid__resize-handle touch-action none`.
- Mine (nested-scroller branch): I forced the hit card's `.markdown-panel` to `overflow-y: auto; max-height: 60px`. The
  375 run failed with `div.markdown-panel is a nested scroller`. The 390 run passed because, once the panel shrank, the
  point no longer landed in it, which is the correct result. So this branch can be made to fail by mutation.

Both probe files were removed afterwards. `git status` is clean and there are no `zz-*` files in `e2e/`.

Code quality: the helpers are small and named, `STABLE_FRAMES` is a named constant, and the failure messages carry the
hit chain. Neither settle wait has a sleep, a retry or a bigger timeout (default `expect.poll`).

### Phase 3: UI Review — N/A
No trigger paths changed (`e2e/` and `openspec/changes/` only).

### Overall: PASS

### Non-blocking Suggestions
- `hel1656-pull-to-refresh.spec.ts` (around line 323): the settled-scroll poll already returns the settled `scrollTop`,
  but `start` is read again in a separate `evaluate`. Taking `start` from the polled value would remove the extra round
  trip, where the value could in principle change.
- The settled-layout wait does not mean the offset stays at the 300 that was written. In 10 of my 80 runs, `start`
  settled at 400. Anchoring still moved it after the write. This is harmless because `start` is the post-write settled
  value and the touch point is chosen afterwards, but the comment "cards finish sizing ... which clamps and anchors" may
  overstate what that first wait guarantees.
- The follow-up from the planner notes is still worth filing: on phone dashboards, a drag that starts on a Table
  header column-resize handle cannot pan the page.

Evidence: `/home/matt/Development/helio/.concertino/scratch/HEL-1682/` (executor's evidence);
`/home/matt/Development/helio/.concertino/scratch/HEL-1682/eval1-green80.log` and `eval1-mut-scroller.log` (my runs).

# Red-or-guard evidence (C7), HEL-1605

All runs: this worktree (`.../HEL-1605`), dev server `DEV_PORT=7037`, `nice -n 19 npx playwright test ... --workers=2 --repeat-each=3`,
specs `e2e/hel1574-shell-rail.spec.ts` + `e2e/hel1605-row-delete-confirm.spec.ts`, filter
`-g "double-click|double-clicking|I4|I6|I8|I14|I19|I17"` (10 distinct cells x 3 = 30 runs). Base = `cd64409ad` with
`frontend/src` stashed (`git stash push -u -- frontend/src`); the e2e files and support helper stay.

## Test-design deviation that made the cells red (read first)

On base, locally, the restored 375 double-click test PASSED 3/3 even with fresh rows: the DOM label only changes length
when a row is <= 1 s old at render AND re-rendered later, which a local run does not hit by timing luck (CI did, run
38665737092). To make the defect deterministic every double-click cell now (a) installs a browser clock that starts 1.5 s
before the earliest row (`installFreshClock`), so first render reads "just now", (b) asserts the target row still reads
`/just now|seconds? ago/` immediately before the gesture, and (c) jumps the clock 8 s (`agePage`, `page.clock.fastForward`;
no timer fires more than once, so the 60 s `useNow` tick is not reached). Nothing waits for labels to settle. With this
the 375 test is red on base 3/3 (`pressTargets` mismatch: press 2 on another row) and green on the fix.

## Result per cell (3 runs each)

| Cell | Base cd64409ad | Fix | Guard / mutation |
|---|---|---|---|
| hel1574 375 double-click, fresh rows (I2, restored from fixme) | RED 3/3: `expect(pressTargets).toEqual([Delete X, Delete X])` | green | red on base |
| hel1574 HEL-1604 820/400 (both pages; I2, I7) | RED 3/3, same assertion | green | M1 red 3/3 |
| hel1574 HEL-1604 375/400 (both pages) | RED 3/3, same assertion | green | M1 red 3/3 |
| hel1574 1280 long list (I3, existing, settled layout) | green 3/3 (not new; no relabel shift at 1280) | green | not a C7 cell |
| I6 keyboard reveal clears BottomNav, 375, both pages | RED 3/3: `expect.poll` true expected, false received (confirm under the nav) | green | red on base |
| I4 pointer reveal, 375, both pages | RED 3/3: same poll | green | red on base; M6 (REVEAL_DELAY_MS=0) red 3/3 on the "no scroll in the first 450 ms" assertion |
| I8 switch, B directly below A's confirm, 375 (+I15) | RED 3/3: `pressTargets` mismatch | green | M2 (no-op pin) red 3/3; M1 red 3/3 |
| I14 switch, A's confirm above the viewport, 375 (+I15) | RED 3/3: `pressTargets` mismatch | green | M1 red 3/3. NOT failed by M2 in the final code (Chrome scroll anchoring absorbs the closing confirm in this geometry, as the design predicted); I14 is classified red-on-base, I8 is the M2 guard |
| I19 switch near page top, press 2 on Cancel, 375 pipelines | RED 3/3: `toHaveCount(1)` expected, 0 received (base Cancel cancels B's confirm) | green | M5 (drop `ignoreRepeatClicks`) red 3/3 |
| I17 last row at max scroll, 820/400, both pages | RED 3/3: reveal poll false (double-click half green on base) | green | M0 (remove `detail > 1` row guard) red 3/3 on the added "press already detail 2 on a non-action cell must not navigate" step; the double-click half alone does NOT fail M0 (with the pin, press 2 lands on Delete, and the actions-cell guard ignores it) |

Counts: base `27 failed, 3 passed (1.9m)`; fix `--repeat-each=5`: `50 passed (2.5m)`; full both spec files, 1 repeat:
`24 passed (53.6s)`. Mutations on the final code: M0 `3 failed, 27 passed`; M1 `17 failed, 13 passed`; M2 `3 failed, 27
passed`; M5 `3 failed, 27 passed`; M6 (4-cell filter) `3 failed, 12 passed`. Each mutation was reverted (diffed against a
backup copy) before the next run.

## I19 geometry

Tuned at 375x700, /pipelines, page at top, table scrolled to its end: A = "HEL-1605 Pipe A longer name here to wrap"
(confirm group ~1 label line taller than B's), B = "HEL-1605 Pipe B short", `dblclick` at the centre of B's Delete. Press 1
lands on B's Delete, closing A's confirm moves B up by ~130 px (page cannot compensate: scrollTop < 5 asserted), press 2
lands on B's own new **Cancel** button (recorded by `recordPresses`; asserted to be Cancel or Confirm, B's top delta > 20).
Confirm itself cannot be hit: B's Delete spans x 289-343 and Confirm ends at x 270, so the cell proves "press 2 on
Cancel does nothing", not "press 2 on Confirm deletes nothing". A shorter A name (62 px confirm) puts press 2 on the page's
"New pipeline" toolbar button instead (see deviations in the report).

## Instrumentation findings

- A single pointer click at 375 on /sources was seen to move the clicked row 130+ px about 40-300 ms later in ~1 of 4 runs.
  Cause (measured with a per-frame sampler of row top, `.app-content` scrollTop and scrollHeight): not a scroll, a late
  re-flow of rows ABOVE the clicked row (all row heights 55 px -> 53 px and the confirm label shrinking), arriving after
  the click. It also happens on base. The I4 "nothing moved" assertion therefore samples scrollTop (reveal = tens of px;
  scroll anchoring of the late shift = a few px) with a 20 px threshold, and the Sources route waits for its references
  response before measuring (`gotoSettled`).
- An experiment that set `overflow-anchor: none` on the scroller from click to confirm close was removed: with it
  removed (M7) all 30 runs stayed green, so no cell needed it.

## Cycle 2: CR1, 768 Sources I14 (1px-overflowing table scroller)

New cell: `768px: I14 (1px-overflowing table scroller): ...` in `e2e/hel1605-row-delete-confirm.spec.ts` (768x900, 22
sources, A = row 2 open, B = row 15 placed 75px above the bottom, fresh clock, `dblclick`; precondition: page
scrollTop >= A's confirm height, i.e. the page can compensate).
- Red against the cycle-1 behaviour (`rowDeleteFocus.ts` at `94521a80f`, swapped in for the run), `--repeat-each=3
  --workers=2 -g "768px"`: `3 failed`, each at `expect(pressTargets).toEqual([Delete B, Delete B])` (press 2 landed
  elsewhere, B slid up under it).
- Green with the fix: `3 passed (15.4s)`; whole HEL-1574/HEL-1605 filter set `--repeat-each=3`: `33 passed (2.1m)`.
- Unit: two new cases in `rowDeleteFocus.test.ts` (1px-overflowing inner scroller inside an outer scroller with room,
  and a delta split across both), using scrollTop-clamping test scrollers.
- Fix: the pin now records every `overflow-y: auto|scroll` ancestor plus the document scroller and `applyPin` hands
  whatever one cannot absorb (measured by the scrollTop that actually changed) to the next.

## Cycle 3: final-gate CR1, `useNow` resubscribed on every render

Cause: an inline `subscribe` closure made `useSyncExternalStore` resubscribe on each re-render; the cleanup cleared the
interval and a fresh 60 s one started, so any interaction pushed the next tick out and labels froze. Fix: `subscribe` and
`getSnapshot` have one identity per interval (cached on the ticker). Because nothing resubscribes, the idle-refresh in
`getSnapshot` also cannot run mid-gesture (it only runs while no interval exists, i.e. before the first subscription).
New unit case "keeps ticking across re-renders" (mount, advance 50 s, `rerender()`, now unchanged, advance 20 s, now ==
first + 60 s):
- Red on e04ddb348's `useNow.ts`: `1 failed, 4 passed`, `Expected: 1767225660000 / Received: 1767225600000`.
- Green on the fix: `5 passed`.
Also: the I8/I14 precondition now compares scrollTop against the inserted confirm ROW's height.

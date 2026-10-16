## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `23aec72567e31dbd008df8365021d5e58fd13b28`. The cycle diff is `b8879d9b4..HEAD`; the full diff base is
`29b39995a`, resolved live. The evidence I produced for this cycle is
`/home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/eval2-*`. I used no isolated DB. All throwaway users
were on the worktree's own servers (7005/9912).

### Gates (my own fresh runs, in WORKTREE_PATH)

| gate | result |
| --- | --- |
| `npm run lint` / `format:check` / `typecheck` | PASS / PASS / PASS |
| `npm test` (2 workers, nice 19) | PASS: 648 suites, 7665 tests |
| `npm --prefix frontend run build` | PASS |
| e2e: `hel1573-motion-primitives`, `hel1573-motion-grid-chart`, `hel1574-shell-rail`, `hel1572-appearance-preferences` | PASS 43/43 in 3.1 min. Load average reached about 18 during this run, from other lanes. `eval2-e2e-affected.txt` |

You noted the executor did not re-run the shell-rail and appearance specs. I ran them here, and both pass.

### Cycle 1 change requests

1. **Tween precision: done.** Frames are rounded to the endpoints' precision (`useValueTween.ts`). On the live app,
   a metric with no format going 1805 to 2905 counted through integers only:
   1805, 1990, 2153 … 2904, 2905. The new unit tests went red under a no-rounding mutant (executor
   `red-C2-1-tween-rounding.txt`).
2. **Token read sites: done.** The value tween now reads the token in a layout effect, and an instant token ends
   the tween before paint. The chart option's render-time read is documented as the single exception in DESIGN.md
   §10 and design.md D6/D10, with the reason. The code matches the docs.
3. **Sleep removed: done.** The spec is now a mode × theme matrix with one user per test. The grid and chart tests
   moved to `hel1573-motion-grid-chart.spec.ts` (263 + 372 lines). The token assertions now run after the
   behaviour assertions, so a mutant fails on behaviour first.
4. **Chart replay case: done, and adequate.** See judgement (b) below.

Non-blocking notes from cycle 1:
- Fill `backwards`: done. On the live app the rows end with `transform: none` and no animation.
- 5.4 feel note: done.
- Motion-group self-slide: not fixed. The new code does not work in a real browser. See CR 1.

### Your two questions

**(a) The stagger threshold of "≥3 of 5": a legitimate de-flake, and the Full control can still go red.** The
recorder reads `getAnimations()` inside the `animationstart` handler. With the new `backwards` fill, a finished CSS
animation is no longer returned, so under heavy load a late handler can miss a row. That is a recorder limit, not a
loss of motion.

The other Full assertions are unchanged: every recorded entrance must move and run 280 ms. On the new spec I
checked that the Full control still goes red:

| mutant | result |
| --- | --- |
| stagger removed | red at "stagger entrances recorded, expected ≥3, received 0" |
| rise removed, fade kept | red at `enter.every(moves && 280ms)` |
| none (control) | passed |

The AC2 side still goes red too:

| mutant | result |
| --- | --- |
| Off + 280 ms stagger with rise | red at `off/dark/load: moving animations` |
| OS-reduce + a Web Animations call | red at `os-reduce/dark/load` |

These are in `eval2-*.txt`. In my own 43-test run, under a load average of about 18, all four Full/Subtle runs still
recorded 5 of 5 rows.

The threshold does not weaken AC2. The Off/OS-reduce assertions never depended on the count. What no assertion
checks, then or now, is the stagger delay progression. That gap is noted below, and is not a blocker.

**(b) The direct `chart.setOption` replay case: adequate for AC5.** I verified the executor's premise. A dashboard
chart has no in-place chart-type change. The Output editor preview remounts its chart on `key={chartType}`
(`OutputPreviewPane.tsx:130`), and a fresh mount enters by design ("once per mount").

So the app's in-place option changes are same-type rebuilds (the labelled guard) plus any view-recreating change.
The case feeds the app's own applied option (`animationDuration: 0`, read back from the live instance) through a
series-type change, which is a view recreation. It can go red: holding the window open gave a 299.8 ms span against
a <60 limit (executor `red-C2-4-chart-typechange-replay.txt`). It also matches my cycle-1 measurement.

Combined with the applied-option assertion (M3b red), this proves the chain. The app applies 0 after the entrance,
and 0 is what stops a recreated view from replaying. The test comment states plainly what the case proves.

### Phase 1: Spec Review — FAIL

AC1, AC3, AC4 and AC5 are met. AC2 (Off / OS reduce) is met and proven. Constraints C1 and C2 hold.
- Under `grid/` the diff touches CSS only.
- There is one motion reader: the new `useIndicatorSlide` code reads `useMotion()` and adds no second source.

The failure is the Indicator slide requirement (motion-primitives spec): "Under Subtle or Off it SHALL move with no
position animation." It is violated for the Motion control itself. When the user switches Full to Subtle, the
indicator still slides at the move duration (CR 1). The executor's comment at `useIndicatorSlide.ts:43-44` claims
this case is handled.

### Phase 2: Code Review — FAIL

`frontend/src/shared/motion/useIndicatorSlide.ts:38-45`: `measure()` writes `--indicator-x`, then reads
`active.offsetTop`/`offsetWidth`/`offsetHeight`. That read forces a style flush while the container is still
`data-indicator="ready"`, which starts the 280 ms transform and width transitions. Setting `snap` afterwards does not
stop them: Chrome keeps a running transition when the duration drops to `0s`.

The new unit test (`useIndicatorSlide.test.tsx`, "never leaves the snap state outside Full") passes in jsdom no
matter what, because jsdom has no transitions. It only checks the attribute, so it cannot detect this.

Everything else in the cycle diff is clean.

### Phase 3: UI Review — FAIL (CR 1 only)

Live app, light theme, user saved Motion = Full, then clicked Subtle in Settings > Appearance > Motion
(`eval2-motion-group-indicator.json`):
- Indicator left, per frame: 221, 221, 232, 242, 251 … 280, 281. That is a slide of about 280 ms under Subtle.
- At the moment `data-indicator` became `snap`, `getAnimations()` already held running `transform` and `width`
  CSSTransitions (currentTime 0), with `data-motion="subtle"` and computed `transition-duration: 0s`.
- Subtle to Off snaps (282 then 363), because the token is already 0.01 ms.
- The density group under Subtle snaps (221 then 341). Under Full it slides (221 → 339). Both are correct.

Everything else re-checked on the running app:
- Rows hold no transform after the entrance.
- Tween frames are integers.
- The shell-rail and appearance specs are green.

### Overall: FAIL

### Change Requests

1. **Fix the indicator snap so it holds in a real browser** (`frontend/src/shared/motion/useIndicatorSlide.ts`,
   `measure()`).
   - Read all four of `active.offsetLeft/Top/Width/Height` into locals before any style write.
   - Decide whether this placement snaps (`motionRef.current !== "full"` or not `ready`). If it does, set
     `data-indicator="snap"` before writing the four `--indicator-*` properties, so no style resolution ever sees
     the new position under the `ready` transition rule.

   Prove it in a real browser, red first. For example, add to `hel1573-motion-primitives.spec.ts`, or to the Subtle
   test: with Motion saved as Full, click Subtle in the Motion group, and assert the indicator reaches its final
   `left` by the second frame with no running transition on `.motion-indicator`. Run it once against the current
   write-then-read order to record the red.

   If that cannot be made reliable, revert the `motionRef` change and its comment rather than keep code that claims
   a behaviour the browser does not show. The original note was non-blocking. The false claim is the defect.

### Non-blocking Suggestions

- The recorder (`e2e/support/motionRecorder.ts`) could record from the `animationstart` event and the target's
  computed `animation-*` values, instead of `getAnimations()`. Then a late handler under load could not drop a
  finished entrance, and "5 of 5" could come back.
- No assertion checks the stagger's delay progression: rows at 0, 40, 80 ms … capped by ~400 ms. A one-line check
  on the recorded `delay`s would cover the "each item one stagger step after the previous" requirement.

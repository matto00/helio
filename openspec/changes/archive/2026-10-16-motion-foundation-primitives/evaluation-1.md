## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `b8879d9b412958dfce5be639be4d60cb216b9f97` (base `29b39995a`, resolved live via resolve-review-base.sh).
Evidence I produced is in `/home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/eval1-*`. Scratch is in
`/home/matt/Development/helio/.concertino/scratch/HEL-1573/eval-*`. No isolated DB was used. All the API traffic in
this review went to the worktree's own servers (7005/9912) as throwaway users.

### Gates (my own fresh runs, in WORKTREE_PATH)

| gate | result |
| --- | --- |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` (`HELIO_JEST_MAX_WORKERS=2`, nice 19) | PASS: 648 suites, 7659 tests (root jest passed before it) |
| `npm --prefix frontend run build` | PASS |
| `e2e/hel1573-motion-primitives.spec.ts` (DEV_PORT 7005) | PASS 7/7 in 3.2 min |
| Backend | N/A (no `backend/**` change) |

### Phase 1: Spec Review — FAIL

- AC1 (tokens, no literals in primitives): PASS. `--motion-duration-move` and `--motion-rise-distance` are in
  `theme.css`. `motionPrimitiveLiterals.test.ts` scans every primitive file, and the executor's M6 shows it going red.
- AC2 (Off / OS reduce: no transform or position animation, real browser, both themes): PASS, on my evidence (see
  Phase 3). The executor's M1/M2 reds landed on the token assertion, so the spec's per-primitive behavioural
  assertions had no demonstrated red. I added that red myself. It is not evidence-shaped non-evidence any more.
- AC3 (unit test and real consumer for each primitive): PASS. Stagger and layout slide are used by `DashboardList`,
  the value tween by `MetricRenderer`, the crossfade by `PanelContent`, and the indicator by `AppRail` and
  `SegmentedRadioGroup`. Each primitive has its own unit test.
- AC4 (one token duration for the grid, HEL-1032): PASS. The C2 e2e checks item, placeholder and container at 0.28s
  in both stylesheet orders, and checks the none-states. The real drag/resize tracks the pointer with
  `transition: none`.
- AC5 (chart entrance at a token duration, no replay on option change, HEL-1034): proven, but only once you add my
  measurement. The spec's own replay check is a guard, not a proof (see CR 4).
- One-reader rule: PASS. The diff adds no new `matchMedia`, `data-motion` attribute read or `localStorage` read. The
  only new reader is `useMotion()`, and `useReducedMotion` derives from it.
- HEL-1575 / react-grid-layout: PASS. Under `features/panels/ui/grid/` the diff touches only `PanelGrid.css` and its
  CSS test. There is no `PanelGrid.tsx`/`DesktopPanelGrid.tsx` edit, and nothing changes how the grid receives
  layouts, breakpoints, children or keys. `PanelContent` now wraps its body in `Crossfade`, but that sits inside a
  grid item and does not change the grid's children or their keys.
- Constraints C1 and C2: honoured. C2 has one benign tie. The vendor `.react-grid-item.cssTransforms` and our
  `.panel-grid > .react-grid-item` are both 0,2,0, but both declare the same transition-property list. The spec
  proves the result is identical in either stylesheet order.
- Planning artifacts reflect the implementation: FAIL. See CR 2.

### Phase 2: Code Review — FAIL

- `useValueTween` reads the token during render, inside its adjust-state-while-rendering block
  (`frontend/src/shared/motion/useValueTween.ts:33`). `useChartEntranceMotion` reads it in a `useMemo` during render
  (`frontend/src/features/panels/ui/useChartEntranceMotion.ts:94`). design.md D6 and D10 and DESIGN.md §10 ("JS reads
  token durations in effects") all say the opposite (CR 2).
- The value tween formats intermediate frames with the metric's formatter, which shows up to 2 fraction digits for
  the default/`number` format. An integer metric therefore counts through decimal values (CR 1).
- The e2e spec sleeps 62 s inside each of its four Motion-mode tests: about 248 s of fixed waiting, which shows up
  as about 3 minutes of CI time (CR 3).
- Everything else is clean: types, no dead code, no FQNs, tokens only in the new CSS, and tests that exercise the
  real code paths.

### Phase 3: UI Review — FAIL (CR 1. Everything else passes)

**AC2 behavioural red (the orchestrator's first question).** Two layers make every CSS primitive instant under Off
and OS reduce. The first is the role tokens. The second is a pre-existing (HEL-1572) global
`:root[data-motion="off"] * { animation-duration/transition-duration: 0.01ms !important }` rule, with an OS-reduce
twin, at `theme.css:561-573`. A plain-specificity mutant is overridden by that rule: my first `.motion-enter` mutant
passed the spec for exactly this reason.

So I ran mutants that change behaviour without changing any token. They use an injected stylesheet with
higher-specificity `!important` rules, or an injected Web Animations call. They ran through a scratch copy of the
spec (`eval1-mutant.spec.ts.txt`), with no worktree edits. Every one went red at the per-primitive behavioural
assertion, after the token assertion had passed:

| mutant | mode/theme | failed at |
| --- | --- | --- |
| stagger 280ms + 6px rise | off/light | `load: moving animations` (`motion-enter` 280 ms, `dashboard-list__item`) |
| indicator 280ms transform | off/light | `load: moving animations` (`motion-indicator.app-rail__indicator`) |
| grid item 280ms transform | off/light | `grid: moving animations` (`react-grid-item`) |
| WAAPI `animate` on a row | off/light | `load: moving animations` / waapi |
| indicator 280ms transform | os-reduce/dark | `load: moving animations` |
| no mutant (control) | off/light, os-reduce/dark | passed |

Logs: `eval1-red-{stagger-hi,indicator-hi,grid-hi,waapi,osr-indicator-hi}.txt`. In the live app (dark theme, Motion
Off) the density indicator jumped 221 to 341 px in one frame, and nothing slower than 0.01 ms was running. Under
Full the same control slid over about 12 frames. AC2 is proven.

**AC5 / HEL-1034 (the orchestrator's second question).** The spec's bar-collapse check exercises a same-type data
refresh. The executor admits that refresh never replayed, even before the fix, so that check cannot go red on the
case it exercises. The applied-option assertion can go red (M3b). It only shows the app sets
`animationDuration: 0`, not that 0 prevents a replay.

I measured the missing link on the running app (`eval1-chart-typechange.json`, spec `eval1-chart.spec.ts.txt`). A
`notMerge` series-type change (line to bar) at `animationDuration: 1000` replays the entrance: a 1031 ms span, and
the bars grow from 10 % of their height. The same change at `animationDuration: 0` produced no animation span, and
the bar height stayed at 100 % (ratio 1.0). At 280 ms, bar to line replayed (466 ms).

So, in the browser:
- The app applies 0 after the window (M3b can go red).
- 0 suppresses the replay a series-type change would otherwise cause.

That proves the AC. The spec still needs a replay-capable case or a corrected label (CR 4).

At rest the live option still holds `animationDuration: 280` until the next natural rebuild. That is by design
(D10): the rebuild itself carries 0.

**The 62 s sleeps (third question).** The sleep resets the per-user 120 req/min bucket between the light and dark
passes. That bucket is per principal, so a fresh user per theme pass avoids it. Other specs already do this through
`registerAndLogin(..., isolate: true)`. Making theme part of the test matrix (8 tests, one user each) keeps identical
coverage, removes the sleep, and parallelises under the existing `mode: "parallel"`. One precedent exists
(`hel1392-remount-request-burst.spec.ts:136`, a single 62 s wait). This spec pays it four times on every CI run, so
I treat it as a defect (CR 3), not a design choice.

**Value tween, observed.** I created a metric output with no `format`, then changed its data live from 1590 to 2690
under Full. Frame by frame, the aria-hidden text read 1590, 1775.32, 1938.55, 2080.32 … 2684.9, 2689.88, 2690
(`eval1-metric-tween-trace.json`). The text grows from 4 to 7 characters and back. design.md's own risk line
("Tween text width jitter → … verify") was only checked with `format: "integer"`. With that format the frames round
correctly.

**Other checks**
- Happy path: the rail indicator, segmented indicator, list stagger, layout slide on delete, crossfade and grid
  reflow all work in both themes. Screenshots: my `eval-ui-*.png` in scratch, and the executor's matrix in evidence.
- Unhappy paths: the empty, error and loading states are unchanged. The `Crossfade` skeleton keeps
  `aria-label="Loading data"`.
- No console errors from this change. The only error was a 502 on `/run-events` (an SSE proxy, environmental), plus
  two ECharts "Can't get DOM width or height" warnings on the mobile-stack remount. The warnings may be pre-existing,
  so I did not attribute them to this change.
- Accessibility: the indicators are `aria-hidden`, the active items keep `aria-current`, the radios keep their
  roving tabindex, the tween's in-flight text is `aria-hidden` with sr-only final text, and the leaving skeleton is
  `inert`.
- Breakpoints 1440 / 1100 / 768 / 375 in dark: no breakage after settle. At 375 I saw one frame of the chart clipped
  about 3 s after a 1100→375 resize. It was correct on the next capture and I could not reproduce it.
- Visual cohesion against `Motion.dc.html`: the indicator is an accent-dim wash that slides on the ease-out curve,
  as on the board (the board uses 0.32 s; ours is the token's 280 ms). The board's 8 px rise with `scale(.985)` is
  6 px with no scale here, as design.md D2 records. Subjective feel is left to the skeptic.

### Overall: FAIL

### Change Requests

1. **The value tween shows decimals the data does not have.**
   `frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:178-182` builds `shownText` from
   `formatMetricValue(String(tweenedValue), format)`. For the default/`number` format (`maximumFractionDigits: 2`),
   an integer metric counts through values like `1775.32`.

   Fix: round each in-flight frame to the precision of the endpoints. Use the larger of the fraction-digit counts of
   the previous and target raw values, so integer to integer stays integer. Add a `MetricRenderer` unit test: with
   no `format`, every in-flight frame of 120→180 matches `/^\d+$/`. A decimal metric must still tween at its own
   precision.

2. **The docs claim token reads happen in effects. The code reads during render.** Either:
   - (a) move the reads into effects: the instant check in `useValueTween.ts:33-34`, and the `durationMs` passed by
     `useChartEntranceMotion.ts:90-96`, for example into a ref updated in a layout effect; or
   - (b) correct DESIGN.md §10 ("JS reads token durations in effects") and design.md D6/D10 to say what the code
     does, including the one-render-stale window after a Motion change.

   HEL-1584 builds on this contract, so it has to be accurate.

3. **Remove the 4×62 s sleep in `e2e/hel1573-motion-primitives.spec.ts:163`.** Make the theme a test dimension:
   `for (const mode …) for (const theme …) test(...)`, each test registering its own isolated user. Delete the
   `waitForTimeout(62_000)` and the rate-limit comment. This also brings the 572-line file toward CONTRIBUTING's
   ~400-line split threshold. Moving the C2/C1 `describe` block into its own spec file finishes that job.

4. **Make the chart "no replay" check able to go red, or label it as a guard.** In the chart test
   (`e2e/hel1573-motion-primitives.spec.ts:351`), after the window has closed, add a replay-capable option change:
   a series-type change, for example the panel's chart type bar→line through the UI or `PATCH /api/panels/:id`
   appearance. Assert that the drawn bars/line do not grow from zero, using the same `__chartBars` /
   `__chartEdges` signals. Record its red by running it once with the window held open (M3b-style).

   If that change remounts the chart (a fresh mount legitimately enters), say so in the spec instead, and relabel the
   bar-collapse assertion as a guard. Its current message, "no entrance replay", overclaims for a same-type refresh
   that never replayed. Also add the executor-side red for the AC2 behavioural assertions to evidence. My mutant runs
   (`eval1-red-*.txt`) can be cited.

### Non-blocking Suggestions

- `motion.css` `.motion-enter` uses fill `both`. After the entrance, each list row keeps a computed
  `transform: matrix(1,0,0,1,0,0)` for good (verified in the live app). That makes every row a stacking context and a
  containing block for `position: fixed` descendants. `backwards` holds the hidden start state through the delay and
  then releases it.
- Picking Subtle or Off in the Motion radio group itself slides that group's indicator at Full timing once (221→282
  px over about 12 frames). The transition starts before `data-motion` lands. This is harmless.
- Task 5.4 asks for a note on drag/resize feel. The evidence has the drag/resize numbers and screenshots, but no
  written feel note.

### Evidence index (evaluator)

- `eval1-red-*.txt`: AC2 behavioural mutants going red (scratch-config runs against the worktree's own servers).
- `eval1-chart-typechange.json` and `eval1-chart.spec.ts.txt`: replay on a type change at a non-zero entrance
  duration, and none at 0.
- `eval1-metric-tween-trace.json`: the decimal frames of CR 1.
- `eval1-mutant.spec.ts.txt`: the scratch spec copy used for the mutants.

## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: `11bbc2636767c3eac9e41a53d40ca85ec5a80d31`. Diff base resolved live: `29cb0a60f` (`resolve-review-base.sh`, exit 0).

### What I verified (with evidence)

**Gates (run fresh by me at 11bbc2636)**
- `npm run typecheck` exit 0. `npm run lint` exit 0 (`--max-warnings=0`). `node scripts/check-tokens.mjs`: OK.
- Targeted jest (2 workers; motionTokenGuard, motionPrimitiveLiterals, appearanceTokens, every new primitive, Crossfade,
  SuspenseFallback, Modal, CommandPalette, PanelGrid/DesktopPanelGrid/MobilePanelStack incl. commitPin, PanelList,
  panelsSlice, ChartPanel/chartShapeSignature/chartDataOptions/buildChartOption, MetricRenderer, SaveStateIndicator,
  TimelineMark): 121 suites, 1209 tests passed.
- Real browser, under flock, 2 workers, nice 19, DEV_PORT 7016: `e2e/hel1584-motion-surfaces.spec.ts` +
  `hel1575-switch-measurement.spec.ts`: 14 passed, 1 skipped (the env-gated switch measurement). That run includes
  Off and OS reduce (`motion: null` + `reducedMotion: reduce`) x light/dark on grid, modal and palette, with a Full
  control on the same selectors that must show movement (spec lines 236-290), so the Off/OS-reduce check can go red.
- Added-line scan of `frontend/src` (non-test) for time/easing literals: none outside comments. Every new duration or
  easing is a `--motion-*` token.

**Driver invariants**
- `PanelGrid key={selectedDashboardId}` is kept inside the new Crossfade (`PanelList.tsx`). The skeleton's dashboard-id
  key (`DesktopPanelGridSkeleton`) is untouched by the diff.
- No change to `layouts`, breakpoint derivation, cols, compactor, handlers or child keys in `DesktopPanelGrid`. The only
  additions are a reading-order `useMemo`, `useKeyedEntrance`, and `data-entrance` / `--motion-index` on the wrapper div.
- Live DOM after a cold Full load: every `.panel-grid > .react-grid-item` class list is
  `react-grid-item cssTransforms react-resizable…`, with no `motion-*` class. The entrance is on `[data-entrance]`.
- The diff touches no file under the assistant, pipelines, AppRail, tab strip or phone nav/chips. `MobilePanelStack`
  only gains entrance classes and the tap origin; its layout is unchanged.

**Acceptance criteria**
- AC1 (items 1-5 on the primitives and tokens only), traced in code:
  - Item 1: `PanelGrid.css` lift/settle/entrance rules, `useKeyedEntrance`, `useFirstMountForToken`,
    `panelsSlice.itemsOrigin`/`loadId`.
  - Item 2: `chartShapeSignature.ts` plus `ChartPanel` `notMerge={!sameShape}` / `replaceMerge`, and the
    `MetricRenderer` delta tween.
  - Item 3: the `Crossfade` `contentFade`/`block`/`keepContentMounted` options, `RouteSuspense`, `PanelList`.
  - Item 4: `expandFrom.ts`, the `Modal` `expandFrom` prop, the backdrop keyframes.
  - Item 5: `CommandPalette.css` `command-palette-in` and `StaggeredResults`.

  The token guards are green. Met as engineering. Item 5's on-screen result is refuted below.
- AC2 (Off / OS reduce: no transform or position animation on grid, modal or palette): met. I re-ran it myself
  (above). In the live app under Full, the drag-lift values are what Off and OS reduce neutralise: card
  `matrix(1.01…)` while held, then a settle 1.01 → 0.9998 → none over about 350 ms.
- AC3 ("no layout shift or extra re-render regressions"), on its own terms: **met**. I recomputed every window's
  medians from the raw jsonl (`perf-*-raw/ab/ab2/final.jsonl` and the durable `x-*`/`y-*` copies). They match
  perf.md exactly:
  - CLS 0.001077 in every before and after run.
  - Load commits +0/+1. The named +1 is Crossfade's `skeletonGone`.
  - Drag commits 39 in every run.
  - The jest Profiler pin is unchanged (mount 1, drag 2).

  The trailing clause "dashboard load … keep current performance" is **not met by the plan's own D13 threshold**. Time
  to first content is later in every window: W2 +94, W3 +59, W4 +137, W5 +70 and W6 +221 ms. Long-task total is up in
  4 of 5 windows. That is exactly the pending owner ruling, and I do not refute on it alone.
- AC4 (items 6-8): item 7 is built (save check e2e green both themes; nudge unit-tested). Items 6 and 8 are pending the
  owner's split ruling, so they are neither met nor refuted here.

**Perf evidence: honest? complete enough for the owner's ruling?**
- Honest: yes. The numbers reproduce from raw data. The verdict section discloses that the W3 and W6 misses are FAILs
  under D13. It says W1 was taken under load, and that W6 reuses W1's earlier "before" set. It does not cherry-pick W3.
  The ablations (x-nocf: crossfade removed recovers ~63 of 137 ms in W4; x-noent ~23 ms) are reported as partial.
- Not complete. There are two gaps that bear directly on an accept-as-is ruling (CR3 below):
  - (a) The "after" tree is never named by SHA ("HEAD"). It was the pre-merge branch head (the windows predate
    `4d242f341`), and the merged head 11bbc2636 (with HEL-1583's PanelList/zoom/refresh-line changes) was not
    re-measured.
  - (b) perf.md says the metric is a "lower bound" on perceived delay, but never puts a number on that. Under Full,
    each card is still at opacity 0 at "first content" and needs 420 ms (emphasized) plus up to 400 ms of stagger. So on
    the 12-panel D13 dashboard the last card is fully visible about 0.8 s after content is ready, on top of the measured
    +59-221 ms. That is the number an owner weighing "accept as is" vs "drop the grid entrance" actually needs.

**UI / design judgment (running app, Full, both themes, frames frozen with `getAnimations().pause()`)**
- Grid entrance: the cards rise in reading order with a 40 ms step on the emphasized token (live timings d=0..200,
  dur=420). This reads as the Motion board's card rise (board: 8px / 420 ms / 50 ms). It is good in both themes.
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final/04-entrance-dark-150ms.png
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final/09-entrance-light-200ms.png
- Skeleton→grid on a warm restore. Live layer trace: skeleton for about 66 ms, then the content layer at opacity 1 with
  `data-entrance` absent while the skeleton fades underneath over 280 ms. This is a near-cut, which is consistent with
  HANDOFF's "return within the TTL = instant". Accepted.
- Drag lift: a 1% scale plus `--app-shadow-soft`. It is visible as "picked up" in dark mode. Because it reuses the hover
  shadow, the pickup itself only adds the scale. This is subtle but not wrong, so it stays non-blocking.
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final/05-drag-lift-dark.png
- Detail modal expand-from: one WAAPI from the card centre, uniform scale. The frame at 25 ms shows the dialog emerging
  from the card. The backdrop fades on the quick duration. Good.
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final/11-expand-light-25ms.png
- **Command palette results: off-pattern.** Live timings on open (default list, 16 rows): rows `motion-enter` dur=280,
  delays 0, 40, 80 … 360, then six rows all at 400 (the cap). The group labels (`.command-palette__group-label`)
  carry no entrance and render at full opacity from the first frame.
  - At 120 ms and 330 ms, "NAVIGATION", "GENERAL" and "CREATE" sit alone over empty space, with their rows still
    invisible. The panel looks half-built for about 0.4 s, and the list is not complete until about 680 ms.
  - The board (MotionLive.dc.html, "staggers results by 30ms": `.res` rowin .24s, delays 0/.03/.06/.09) completes in
    about 330 ms and has no orphaned headings.
  - This is the "half-baked" look the ticket exists to remove, on the tool a power user opens most.
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final/07-palette-dark-120ms.png
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final/08-palette-dark-330ms.png
- Console: the only errors were `502` on `/api/pipelines/:id/run-events` (the SSE stream through the Vite proxy during
  navigation). This change touches no pipeline/SSE code, so it is environmental and unrelated.

Evidence-mtime disclosure: none of the conclusions above rests on mtime or directory ordering. The perf conclusions rest
on recomputed jsonl content. The visual conclusions rest on frames frozen at stated `currentTime` values, and the
palette timings are read from `getTiming()` on the live animations.

### Verdict: REFUTE

### Change Requests

1. **Palette group labels must enter with their group** (`frontend/src/features/commandPalette/ui/CommandPalette.tsx`,
   the `group.section && <div className="eyebrow command-palette__group-label">` line inside `StaggeredResults`).
   - Give each label the entrance of its group's first row: the same `motion-enter` class and the same
     `--motion-index` as that row. A heading must never be visible over rows that have not started.
   - Add a CommandPalette test asserting that the label's index equals its first row's index.
   - The e2e already samples the palette, so extend `hel1584-motion-surfaces` Full to assert that no label is fully
     opaque while its first row is at opacity 0.
   - Evidence: `07-palette-dark-120ms.png`, `08-palette-dark-330ms.png`.
2. **Bring the palette stagger into the ticket's and the board's envelope** (ticket item 5: "results stagger ~30ms";
   board: 30 ms step, the whole list in about 330 ms).
   - Today it is a 40 ms step with cap 10, so the default 16-row list takes about 680 ms and its last six rows land
     together.
   - Use a 30 ms step through a token, e.g. `--motion-stagger-tight`, defined in `theme.css` beside `--motion-stagger`,
     zeroed under Off and OS reduce, and pinned in `appearanceTokens.css.test.ts`. A literal is not acceptable.
   - Bound the palette's cap (a palette-scoped `--motion-stagger-cap`) so the last row starts by about 200 ms.
   - Keep the existing `[0,40,80,120]` e2e assertion's intent, updated to the new step.
3. **Complete perf.md for the owner's ruling** (doc only, `.concertino/runs/HEL-1584/evidence/perf.md`).
   - (a) Name the SHAs measured: base `6a8cf3a32`, and the actual "after" SHA for each window. State that the merged
     head `11bbc2636` was not re-measured. Alternatively, run one 5+5 interleaved window on the merged head and add it.
   - (b) Add one line quantifying the perceived delay under Full that the metric excludes: about 420 ms for the first
     card to be fully visible, and up to about 820 ms for the last (420 ms + 400 ms stagger on 12 panels).
   - (c) Restate the per-window deltas next to that line, so the accept / drop-crossfade / drop-entrance options are
     weighed on visible time, not DOM readiness alone.

### Non-blocking notes
- Drag lift reuses the hover shadow (`--app-shadow-soft`). A dedicated `--app-shadow-lift` token in both themes would
  make the pickup read more clearly. It is acceptable as is.
- The settle overshoot on a 1.01 scale undershoots to 0.9998, which is imperceptible. The "give" on drop is effectively
  just the 1% scale-down plus the item glide. That is fine, but do not describe it as an overshoot in the PR.
- `MetricRenderer` `ComparisonLine`: when `format` is null and the delta is an absolute number, the tweened intermediate
  values are passed through `String(value)` and may show long fractional digits mid-tween. It is worth a rounding pass
  consistent with the headline tween.
- Evaluator S1/S2 carry over: the one-off `hel1572-appearance-preferences.spec.ts:459` failure, and no e2e on
  detail-modal geometry during the expand.
- Throwaway users created by this review: `e77c05d7-a3f8-44f5-a155-d3d9d1aadc36` (already absent from `users` 16 s after
  creation, removed by something outside this review) and `b16c7ff3-39f3-4a1b-b7f0-3f237ce43b2d` (deleted by exact id
  at the end of this review). The e2e run's own users were deleted by its global teardown (14 recorded).

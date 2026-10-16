## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 29b39995a741fd34931e1c5b121c8539b2f7fd21 (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/motion-foundation-primitives/HEL-1573`.
- Read ticket.md, proposal.md, design.md, tasks.md, all three spec deltas, premise-validation.md, DESIGN.md §10,
  HANDOFF.md, and the Motion/MotionLive canvas sources (grep of their transition/animation values).
- Premise claims hold: `theme.css:91-98` tokens; Off/OS-reduce blocks pin durations to 0.01ms and stagger to 0ms
  (`theme.css:198-217`); Subtle swaps only the overshoot curve (`theme.css:220`). `ThemeProvider.tsx:73` computes
  `effectiveMotion`; `useReducedMotion` (`:168-171`) is boolean only; `prefersReducedMotion.ts` wraps
  `appearancePrefs.effectiveMotion()`. D1 adds no new source of truth: it exposes the existing context value. The
  DOM-attribute reader (`appearancePrefs.effectiveMotion`) and the context are the two pre-existing readers and stay
  the only ones. Sound.
- D2 role tokens: `--motion-duration-move: var(--motion-duration-standard)` resolves against the same root element,
  so Off/OS-reduce overrides reach it either way, and Subtle zeroes it explicitly. 280ms matches DESIGN.md §10's
  "layout slide / indicator slide = standard". Rise of 6px is inside the ticket's 4-8px band. Sound.
- HEL-1032 DOM: `.panel-grid` is the react-grid-layout root. `DesktopPanelGrid.tsx:166` passes `className` to
  `<Responsive>`, and RGL 2.2.4 `chunk-7ZM5LVH2.mjs:1220` merges it with `"react-grid-layout"` on the root. Items get
  `react-grid-item`, `static`, `resizing`, `react-draggable-dragging`, `dropping` and `cssTransforms`
  (`:489-495`). The placeholder gets `react-grid-placeholder` plus `placeholder-resizing` (`:1202`). The vendor CSS
  (`react-grid-layout/css/styles.css`) has `transition: none` only on `.resizing`, `.react-draggable-dragging` and
  `.react-grid-placeholder.placeholder-resizing`. There is no `static` none state. A CSS-only fix is feasible, but D9
  names the wrong state set (CR2).
- Load order: `PanelGrid.css` is imported both by `DesktopPanelGrid.tsx:52` (after the vendor CSS at `:26`) and by
  `PanelGridSkeleton.tsx:5`, which is reachable from `PanelList.tsx:16` and can load first. Equal-specificity
  overrides of the vendor rules (`.panel-grid` vs `.react-grid-layout`, both 0,1,0; `.panel-grid > .react-grid-item`
  vs `.react-grid-item.react-draggable-dragging`, both 0,2,0) therefore depend on source order (CR2).
- HEL-1034 echarts path: `ChartPanel.tsx:120-133` and `UsageChart.tsx:123-126` use `echarts-for-react/esm/core`
  with `notMerge`. Its `componentDidUpdate` calls `setOption` whenever `fast-deep-equal` of `option` differs
  (`core.js:48-51`). `useChartOption.ts:76-79` runs a mount-time `requestAnimationFrame` -> `setThemeSyncTick`, which
  recomputes the option memo one frame after mount. `useMeasuredChartHeight` updates from 0 to the real height on the
  first ResizeObserver callback. For pie charts of 250px or less and compact charts this changes
  `measuredPieLegendOverlap`, `effectiveCompact` and `valueAxisSplitCap`. Time-axis charts build a fresh formatter
  closure per build (`timeAxisOption.ts:73`). Under D10 as written, these early recomputes break the entrance (CR1).
- DESIGN.md §10 "Known gap (HEL-1573)" and the "until HEL-1573 migrates them" sentence both assign work to this
  ticket. I fetched HEL-1584's text from Linear: its items 1-8 and its ACs never mention the sheet/drawer/toast Subtle
  translate gap or the `--app-transition` consumer migration (CR3).
- D12 red-capability: a Full control case on the same selectors can go red, so the plan for AC 2 is adequate in
  principle. It cannot catch CR1, because jsdom resolves tokens to 0 and D12 only asserts the Off case.
- Consumers exist: `AppRail.tsx:34` and `AppRail.css:2` explicitly await this slide, plus
  `SegmentedRadioGroup.tsx`, `DashboardList.tsx`, `MetricRenderer.tsx` and the `PanelContent.tsx:149-155`
  skeleton path. The tab strip is correctly excluded.

### Verdict: REFUTE

### Change Requests

1. **D10 / task 3.2: the "entered" rule kills the chart entrance on every chart.** D10 lets the entrance run "until
   the first option carrying data has rendered". After that, `applyChartMotion` emits `animationDuration: 0`. One
   frame after mount, `useChartOption.ts:76-79` (themeSyncTick rAF) recomputes the base option. Re-applying motion
   with `entered = true` gives an option that differs from the previous one (280 becomes 0). So
   `fast-deep-equal` fails, and echarts-for-react calls `setOption(..., notMerge)` about one frame into the 280ms
   entrance, which renders the final state instantly. The same happens on the first ResizeObserver measurement for
   compact charts and pie charts of 250px or less, and for time-axis charts with per-build formatter closures. The
   AC would hold on paper while users see no entrance.
   Revise D10 to define the end of the entrance window by echarts completion (the `finished` event) or by the
   entrance duration elapsing, not by first data render. An option set inside the window must carry the same
   entrance parameters, or keep the passed option referentially or deep-equal stable, so the flip alone never
   triggers `setOption`. Flip the ref in an effect or event handler, never during render (StrictMode double-render).
   Add a real-browser check to 5.2/5.3: a freshly mounted Full chart panel repaints for about the token duration
   (not 1 frame, not 1000ms), and a later data or option change does not replay it. Unit tests alone cannot catch
   this, because jsdom gives `readMotionDuration` = 0.
2. **D9 / task 3.1: the none-state list is wrong, and the overrides must not depend on source order.** Replace
   "(dragging, resizing, static)" with the real vendor set: `.resizing`, `.react-draggable-dragging`, and
   `.react-grid-placeholder.placeholder-resizing` (the vendor rule is 0,3,0, so a new 0,3,0 placeholder timing
   rule after it would make the placeholder animate during resize). There is no `static` none state.
   Also require every HEL-1032 rule to win by specificity, not by stylesheet order, because `PanelGrid.css` is also
   imported by `PanelGridSkeleton.tsx:5`. For example: `.panel-grid.react-grid-layout` for the container height,
   `.panel-grid > .react-grid-item.react-grid-placeholder` for the placeholder, and none states one level above the
   timing rules.
   Add an objective real-browser assertion to 5.4: the computed `transition-duration` of a dragging item, a resizing
   item and a resizing placeholder is `0s`, and the grid/item/placeholder durations all equal the resolved
   `--motion-duration-move`. Subjective feel notes alone are not enough.
3. **D11 / proposal Non-goals: the "Known gap" handoff to HEL-1584 is not honest as written.** DESIGN.md §10 assigns
   both items to HEL-1573: the sheet/drawer/toast translate entrances under Subtle, and the `--app-transition`
   migration. HEL-1584's actual ticket text covers neither. Pick one of two fixes:
   (a) Close the Subtle gap here. It is three stylesheets with existing two-selector blocks: `shared/ui/toast.css`,
   `shared/chrome/MobileNavSheet.css` and `features/dashboards/ui/RefinementChatDrawer.css`. Add a
   `:root[data-motion="subtle"]` opacity-only variant to each. This also makes the ticket's system-level Subtle
   definition true.
   (b) File a dedicated follow-up ticket linked to HEL-1570 and HEL-1584 for each deferred item, and cite those IDs
   in DESIGN.md and in proposal Non-goals instead of "HEL-1584".
   Either is within planner authority. Silently re-pointing to a ticket that does not own the work is not.
4. **D7 / task 2.4: Crossfade has a stuck-skeleton path.** "Unmounts on `transitionend`" fails when no transition
   ever starts. Examples: loading flips to ready before the skeleton layer has painted, the opacity is already at
   its end value, or the layer is not rendered. The skeleton then stays mounted forever, invisible, stacked in the
   cell, and still carrying its loading semantics for assistive tech. Specify three things. First, the skeleton
   layer becomes `aria-hidden`/`inert` as soon as `loading` is false. Second, it unmounts on `transitionend` OR
   `transitioncancel` OR when no transition is running (for example `getAnimations()` is empty after the state
   flip). Third, add a unit test for the no-`transitionend` path. HEL-1584 item 3 reuses this primitive on the
   route Suspense fallback, so the API contract must be right now.

### Non-blocking notes

- D6: state the Subtle gate mechanism explicitly. `--motion-duration-standard` stays 280ms under Subtle, so the tween
  must use `useMotion() === "full"` and not a token. Say so, so that the spec's "timing only from tokens" and
  "Subtle instant" do not read as contradictory.
- `readMotionDuration` reads the cascade. On the render triggered by a Motion-setting change, the root attribute is
  still stale (documented at `useChartOption.ts:56-75`). Read durations in effects or layout effects (D5/D8) and not
  at render time, or accept a one-change lag knowingly.
- D10 Subtle uses `animation: false`, which also removes echarts hover-emphasis colour transitions. DESIGN.md §10 says
  Subtle keeps colour fades. That is acceptable but worth one line in §10.
- HEL-1584 item 2 ("chart line morphs on refresh") is incompatible with `notMerge` plus `animationDuration: 0` on
  updates. Record that in DESIGN.md §10 so HEL-1584 knows it must revisit `notMerge`.
- D12: also include grid items under Off. Make sure the "OS reduce, no saved choice" e2e user really has
  `motion: null` server-side, not only in localStorage, because the pre-paint cache and the server preference can
  disagree.
- D2/D4: the boards use an 8px rise with scale. 6px with no scale is a defensible reading of the ticket's 4-8px
  band; note the choice in §10.

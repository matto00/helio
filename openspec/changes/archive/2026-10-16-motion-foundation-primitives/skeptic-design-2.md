## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 29b39995a741fd34931e1c5b121c8539b2f7fd21 (the planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/motion-foundation-primitives/HEL-1573`.
- Read ticket.md, proposal.md, design.md, tasks.md, all three spec deltas, workflow-state.md, skeptic-design-1.md,
  premise-validation.md and DESIGN.md §10. I judged the whole design fresh, then checked each round-1 CR against the
  code.
- **CR2 (D9) is resolved. I checked it against the vendor CSS** (`node_modules/react-grid-layout/css/styles.css`):
  - Container: `.react-grid-layout` (0,1,0) carries `transition: height 200ms`. D9's `.panel-grid.react-grid-layout`
    (0,2,0) wins.
  - Items: `.react-grid-item` (0,1,0) carries `transition: all 200ms`. D9's `.panel-grid > .react-grid-item` (0,2,0)
    wins.
  - Placeholder: `.react-grid-item.react-grid-placeholder` (0,2,0) carries `transition-duration: 100ms`. D9's 0,3,0
    rule wins.
  - None states: the vendor's only `transition: none` rules are `.resizing` and `.react-draggable-dragging` (both
    0,2,0, which would tie with our item rule) and `.react-grid-placeholder.placeholder-resizing` (0,3,0, which would
    tie with our placeholder rule). D9 re-asserts each at 0,3,0 and 0,4,0, so none of them depends on import order.
  - D9 is right that there is no `static` none state.
  - The guard's HEL-1032 exception is pinned to exactly three `180ms` literals (`motionTokenGuard.css.test.ts`,
    `PANEL_GRID_EXCEPTION`), with a staleness check. Removing it, as task 3.1 plans, is coherent.
- **CR1 (D10) is resolved in design.** I read `echarts-for-react@3.0.6/esm/core.js`. `componentDidUpdate` calls
  `setOption` only when `isEqual(pick(props, ['option','notMerge',...]))` fails, so an option that is identical in
  the window does not cut the entrance.
  - Closing the window only through a ref, with no rebuild of its own, is sound.
  - User `onEvents` are bound after the first `updateEChartsOption`, so a `finished` handler will see the entrance's
    completion.
  - A changed `onEvents` identity only re-binds. It does not dispose: only `theme` and `opts` changes dispose.
  - `useChartOption.ts:76-79` (the themeSyncTick rAF) is correctly identified as an in-window rebuild.
  - The existing reduced-motion path is series-level `animation: false` (`chartAppearance.ts` `applyHoverEmphasis`).
    Leaving Off as-is is consistent.
- **CR3 (D11) is resolved, using option (a).** All three stylesheets have the translate entrances named
  (`toast.css:194-209`, `MobileNavSheet.css:88-91`, `RefinementChatDrawer.css:58`) and the existing two-selector
  reduced-motion blocks. DESIGN.md §10's "Known gap (HEL-1573)" and "until HEL-1573 migrates them" are both handled
  by D11 and task 4.1.
- **CR4 (D7) is resolved.** The skeleton layer becomes `aria-hidden`/`inert` when loading ends. It unmounts on
  `transitionend`, `transitioncancel`, or no running animation on the next frame. `Element.getAnimations()` flushes
  pending style, so on that frame a transition that will run is visible and one that will not is absent. The
  no-fade path therefore works. Task 2.4 tests all three paths.
- Round-1 non-blocking notes are taken up:
  - D6 now gates the tween on `useMotion()`, not on a token.
  - Durations are read in effects (D6).
  - Subtle keeps echarts state animation (D10).
  - The `notMerge` / morph caveat goes into DESIGN.md (D10).
  - Grid items under Off and the server-side `motion: null` are covered (D12).
  - 6px with no scale is recorded (D2, D11).
- Fresh checks:
  - **D1 is a derivation, not a second reader.** `ThemeProvider.tsx` `useReducedMotion` already reads
    `context.effectiveMotion` with a `useOsReducedMotion` fallback. `useMotion` exposes the same value.
  - **D2 works under every Motion setting.** Off and OS-reduce zero the new tokens. Separately, the global
    `:root[data-motion="off"] *` rule (`theme.css:555-561`, with a scoped OS twin at 544-553) already forces 0.01ms
    on every CSS transition and animation.
  - **D4.** The stagger cap is 10 × 40ms = 400ms, which matches DESIGN.md §10.
  - **D5.** The consumer `DashboardList.tsx` renders keyed `<li>` rows across several `<ul>`s (folder groups, lines
    604-630). A `data-motion-key` scan over the container covers moves between folders.
  - **D6.** `MetricRenderer` values are strings formatted by `formatMetricValue`. D6's "finite → tween, settled
    frame = exact original string" fits that.
  - **D8.** AppRail's active item can be in `.app-rail__nav` or `.app-rail__foot` (Settings, line 101).
    `SegmentedRadioGroup` exposes `--selected`.
  - The tab strip and `PanelGrid.tsx`/`DesktopPanelGrid.tsx` are excluded, so the HEL-1575 boundary holds.
- **Spec deltas.** The MODIFIED `appearance-preferences` requirement matches the live header at
  `openspec/specs/appearance-preferences/spec.md:93` and carries the full text plus one new scenario.
  `echarts-chart-panel` is ADDED. `motion-primitives` is new (no existing dir).
- **AC coverage:**
  - AC1 is covered by D2/D3 and task 5.1.
  - AC2 is covered by D12 and task 5.2, with a red-capable Full control.
  - AC3 is covered by tasks 2.1-2.5, five primitives each with a consumer.
  - AC4 is covered by D9 and task 3.1.
  - AC5 is covered by D10, tasks 3.2 and 5.2, and C1.
  - I found no placeholders or TBDs, and no contradictions between the proposal, design, tasks and specs.

### Verdict: CONFIRM

The four round-1 change requests are fixed against ground truth. I found nothing that would make an implementer
build the wrong thing or leave an AC untraceable. The notes below are refinements for the executor and the final
gate. None blocks.

### Non-blocking notes

1. **D7: the content layer's fade mechanism.** If `children` mount only when `loading` turns false, which
   PanelContent's early-return structure implies, a CSS *transition* on the new content layer never runs: a freshly
   inserted element has no before-change style. Use an `@keyframes` fade-in (fill `both`) for the incoming layer, and
   keep the transition for the outgoing skeleton. Also state in §10 whether children render while loading. HEL-1584
   reuses Crossfade for Suspense fallbacks, where they cannot render.
2. **D5/D8 vs D2: "duration 0" and 0.01ms.** Under Subtle and Off `--motion-duration-move` resolves to 0.01ms, not
   0, so D5's "duration 0 means no animation call" is never literally true in a browser. Do one of two things: treat
   ≤ 0.01ms as instant in `readMotionDuration` consumers, or gate on `useMotion() === "full"` as D6 does, so a Subtle
   FLIP never even schedules a 0.01ms WAAPI animation.
3. **D9: a specificity tie the table omits.** The vendor `.react-grid-item.cssTransforms` (0,2,0) sets
   `transition-property: transform, width, height` and ties our 0,2,0 item rule. This is harmless only while our
   item rule lists exactly those three properties, in that order. If the executor writes `transition: all ...` or
   adds `left`/`top`, the outcome becomes load-order dependent, which C2 forbids. Keep the three-property shorthand,
   or bump the item rule to 0,3,0 (`.panel-grid > .react-grid-item.cssTransforms`).
4. **D10: the entrance can be cut by a resize.** `echarts-for-react` calls `echartsInstance.resize()` through
   size-sensor after the initial callback. Its own source notes that this "will cancel initial echarts animations".
   In the dashboard grid, item width/height now transition over 280ms, so a mount-time width settle can cut the
   entrance. Run the C1 real-browser check on a chart inside the real dashboard grid, not an isolated chart. Measure
   the elapsed-time fallback from `onChartReady` (the first real `setOption`; init is async), not from React commit.
5. **D10: legend toggles lose their animation.** Setting `animationDurationUpdate: 0` after the entrance under Full
   also removes the update animation for in-chart interactions such as legend toggles and dataZoom. Replay prevention
   needs only `animationDuration: 0`, because `notMerge` rebuilds play as entrance. Consider keeping
   `animationDurationUpdate` at the token, or record the trade-off in §10.
6. **D10: the duration's initial value.** `durationMs` is read in an effect, so state what the first render uses
   before the effect runs. If that render emits `animationDuration: 0` and the effect then flips it to 280ms, the
   difference triggers a second `setOption`. Async init will usually absorb this, but make sure the C1 check would
   catch a visible flash.
7. **D3/5.1: the literal guard scope.** Crossfade lives at `shared/ui/Crossfade.tsx`, outside `shared/motion/**`.
   Include it, and its CSS, in the TS literal guard so AC1 ("every primitive") is enforced for all five primitives.

## Context

See proposal.md (Why). Already on main (HEL-1571/1572): `--motion-*` tokens in `theme/theme.css` (Off and
OS-reduce-without-preference pin durations to 0.01ms, Subtle only swaps the overshoot curve); `appearancePrefs.ts`
`effectiveMotion()` (one-shot, full|subtle|off); `ThemeProvider` context field `effectiveMotion`; `useReducedMotion()`
(boolean); `utils/prefersReducedMotion.ts` (boolean, used by ECharts option builders and Toast). No primitive exists.
`PanelGrid.css` hard-codes `180ms ease` on grid items (pinned as an exception in `motionTokenGuard.css.test.ts`);
the vendor `react-grid-layout/css/styles.css` adds 200ms (container height) and 100ms (placeholder). `ChartPanel.tsx`
and `UsageChart.tsx` pass `notMerge={true}` and set no `animation*` option. `AppRail.tsx` says the active item is
"static until the motion foundation, HEL-1573, adds the slide". HEL-1575 is concurrently changing the dashboard
tab strip and investigating a react-grid-layout `setLayout` loop.

## Goals / Non-Goals

Goals: one reader; Subtle made real for primitives; five primitives with tests and consumers; HEL-1032 and HEL-1034
closed; API stable enough for HEL-1584. Non-goals: see proposal.md Non-goals. No new dependency (no motion library).

## Decisions

**D1. One reader.** Add `useMotion(): Motion` next to `useReducedMotion` in `ThemeProvider.tsx`: the context's
`effectiveMotion`, or outside a provider `useOsReducedMotion() ? "off" : "full"`. `useReducedMotion()` becomes
`useMotion() === "off"`. Non-React code keeps `appearancePrefs.effectiveMotion()` (and `prefersReducedMotion()` stays
its boolean wrapper). Primitives read only these. Alternative rejected: a MutationObserver on `data-motion` (a
second source that could disagree with context).

**D2. Role tokens for Subtle.** Add to `:root` in `theme.css`: `--motion-duration-move: var(--motion-duration-standard)`
(anything that translates or repositions: layout slide, indicator slide, grid items) and `--motion-rise-distance:
6px` (entrance rise; the ticket's 4-8px band, the boards use 8px with a slight scale we drop). `:root[data-motion=
"subtle"]` and both Off blocks set `--motion-duration-move: 0.01ms` and `--motion-rise-distance: 0px`. Fades keep
`--motion-duration-standard`, so Subtle keeps opacity and colour. Alternative rejected: per-primitive
`[data-motion="subtle"]` selectors (every HEL-1584 consumer would repeat them). Token names are an API HEL-1584
builds on; DESIGN.md §10 records them.

**D3. Reading durations in JS.** `shared/motion/motionTokens.ts` `readMotionDuration(name, el?)` parses the computed
custom property (`ms` or `s`) on the root; unresolved/empty (jsdom) returns 0. Every JS primitive treats a duration ≤ 0.01ms (Subtle/Off resolve
to 0.01ms, never 0) as "instant" and makes no animation call. No duration literal exists in any primitive; a unit guard scans `shared/motion/**` for numeric `ms`/`s`
literals and fails on any.

**D4. Staggered entrance** (`shared/motion/stagger.ts` + `motion.css`). CSS utility `.motion-enter`: keyframe from
`opacity:0; transform:translateY(var(--motion-rise-distance))`, duration `--motion-duration-standard`, curve
`--motion-ease-out`, fill `both`, delay `calc(min(var(--motion-index), 10) * var(--motion-stagger))` (cap: last
item starts by ~400ms, DESIGN.md §10). Hook `useStaggeredEntrance()` returns `itemProps(index)` (class + `--motion-index`)
for items present in the first non-empty render; items mounted later get index 0 (a single rise, no queue). One
entrance per surface: re-renders never replay. Consumer: `DashboardList` (context list), when its rows first load.

**D5. Layout slide** (`shared/motion/useLayoutSlide.ts`). FLIP over children carrying `data-motion-key`: record rects
after each commit; on the next layout effect, animate each moved child from its old offset to identity with the Web
Animations API at `readMotionDuration("--motion-duration-move")` and the ease-out curve string read from
`--motion-ease-out`. Duration 0 (Subtle/Off/jsdom) means no animation call at all. Consumer: `DashboardList` rows when a
dashboard is added, removed or reordered. The panel grid's layout motion stays react-grid-layout's own CSS transforms
(D9) — no FLIP inside the grid.

**D6. Value tween** (`shared/motion/useValueTween.ts`). `useValueTween(target: number | null)` returns the displayed
number: the first value shows immediately (no count-up from 0 on mount); a change tweens with an ease-out cubic via
`requestAnimationFrame` over `readMotionDuration("--motion-duration-standard")`, read inside the layout effect that starts the
tween (never during render: the root attribute can be one render stale after a setting change); an instant or unresolved
token ends the tween in that layout effect, before paint. In-flight frames are rounded to the larger fraction-digit count of
the two endpoints, so an integer metric counts through integers. Subtle and Off swap
instantly, and that decision comes from `useMotion()` — not from the token, which stays 280ms under Subtle because
fades keep it. Consumer: `MetricRenderer` when the value is finite; in-flight text uses the same formatter and the
settled frame renders the exact original value string. Screen-reader text is the final value only. The layout slide, value tween
and chart entrance timer read token durations in (layout) effects, never during render. The single exception is D10's option.

**D7. Crossfade** (`shared/ui/Crossfade.tsx`). `<Crossfade loading skeleton={...}>{content}</Crossfade>` stacks both
layers in one grid cell (no layout collapse); on loading→ready the skeleton fades out, content fades in, over
`--motion-duration-standard` / `--motion-ease-standard`. The moment loading ends the outgoing skeleton layer becomes
`aria-hidden` and `inert` (it never announces "loading" again), and it unmounts on the first of `transitionend`,
`transitioncancel`, or — checked on the next animation frame — no running transition on it (`getAnimations()` empty
or unavailable, e.g. loading finished before the skeleton painted, or jsdom). Opacity only, so it runs under
Subtle; Off makes it instant. Consumer: `PanelContent`'s `isLoading` → body path (`PanelBodySkeleton`).

**D8. Indicator slide** (`shared/motion/useIndicatorSlide.ts`). Measures the active item (offset and size relative to
the container) and writes `--indicator-x/-y/-w/-h` on the container; a `.motion-indicator` element translates/sizes
with `--motion-duration-move` + `--motion-ease-out`. The first measurement and any hidden→shown change apply without
transition (no slide from 0,0). Re-measures on `ResizeObserver`. No active item hides it. Consumers: `AppRail`
(vertical; the indicator becomes the active accent wash) and `SegmentedRadioGroup` (horizontal). Not the dashboard
tab strip (HEL-1575).

**D9. Panel grid (HEL-1032), CSS only.** In `PanelGrid.css`, grid items `transform/width/height`, the placeholder and
the container `height` all use `var(--motion-duration-move) var(--motion-ease-out)`. Every override beats its vendor
selector by specificity, never by import order (`PanelGrid.css` is also imported by `PanelGridSkeleton.tsx` and can
load before the vendor sheet): container `.panel-grid.react-grid-layout` (0,2,0 > vendor 0,1,0); items
`.panel-grid > .react-grid-item` (0,2,0 > vendor `.react-grid-item` 0,1,0); placeholder timing
`.panel-grid > .react-grid-item.react-grid-placeholder` (0,3,0 > vendor 0,2,0). The vendor's real `transition: none`
states are re-asserted above our timing rules: `.panel-grid > .react-grid-item.react-draggable-dragging`,
`.panel-grid > .react-grid-item.resizing` (0,3,0 > our 0,2,0) and
`.panel-grid > .react-grid-item.react-grid-placeholder.placeholder-resizing` (0,4,0 > our 0,3,0). There is no
`static` none state. The 100ms placeholder lead is not kept: the AC asks for one token duration. The guard's 180ms
exception is removed. No `PanelGrid.tsx`/`DesktopPanelGrid.tsx` edit; if one proves necessary, escalate first.

**D10. Charts (HEL-1034).** A pure `applyChartMotion(option, {motion, entrance, durationMs})` in
`utils/chartAppearance.ts`: Full + entrance → `animationDuration` and `animationDurationUpdate` = `durationMs`
(`--motion-duration-standard`, read while the option is built: the option is a render product applied by echarts-for-react's own mount, so it cannot wait for an effect; it can lag one render behind a Motion change until `useChartOption`'s post-paint `effectiveMotion` rebuild), `animationEasing: "cubicOut"` (closest named echarts curve to the
token ease-out); Full after the entrance → `animationDuration: 0` only (no replay under `notMerge`; `animationDurationUpdate` keeps
the token so legend toggles and dataZoom still animate); Subtle → `animationDuration: 0`, `animationDurationUpdate: 0` with `animation` left on, so hover-emphasis
colour fades (echarts state animation) survive, as DESIGN.md §10 keeps fades under Subtle; Off → the existing
`animation: false`. The entrance window is owned by `ChartPanel` and `UsageChart` in a ref (`entranceDoneRef`), not
state: it closes on the echarts `finished` event, or when `durationMs` has elapsed after the first option carrying
data rendered, whichever is first. Closing it never triggers a rebuild or `setOption` by itself; the 0 takes effect
on the next naturally-occurring option rebuild (theme tick, resize, data refresh, config edit). Rebuilds inside the
window (the one-frame `themeSyncTick` rAF in `useChartOption.ts`, the first ResizeObserver measure) keep the entrance
duration, so the deep-equal in echarts-for-react sees no diff and the entrance is not cut. A rebuild inside the
window that does differ (e.g. a time-axis formatter identity) restarts at most one ~280ms entrance — acceptable,
and bounded by the window. `notMerge={true}` stays (its stale-series rationale holds); DESIGN.md records that a
future morph-on-refresh (HEL-1584) must revisit it. Proof is real-browser (C1): a new Full chart animates for about
the token duration and a refresh does not replay it.

**D11. Subtle gap and shorthands.** This ticket closes DESIGN.md's "Known gap (HEL-1573)": `toast.css`,
`MobileNavSheet.css` and `RefinementChatDrawer.css` each gain a `:root[data-motion="subtle"]` opacity-only variant of
their translate entrance (and exit). `--app-transition` / `--transition-slow` are documented as permanent aliases of
`--motion-duration-quick` + `--motion-ease-standard` and `--motion-duration-standard` + `--motion-ease-out` (they
already obey Off and OS reduce); no mass migration, and DESIGN.md stops promising one. DESIGN.md §10 lists each
primitive's API, the role tokens (rise 6px, no scale), Subtle as implemented, and the `notMerge` note.

**D12. Real-browser proof.** A Playwright spec sets Motion Off, and OS reduce with no saved choice (the test user's
server preference `motion: null`, not just localStorage), in light and dark, and asserts per primitive (stagger,
layout slide, indicator, crossfade, grid items) that no transform/position animation runs (`getAnimations()` empty or
≤0.01ms, computed transition durations ≤0.01ms); a Full control case on the same selectors must show them animating
(so it can go red). It also asserts grid computed styles in dragging, resizing and placeholder-resizing states (C2),
and the chart timing of D10 (C1). Screenshots/recordings go to `.concertino/runs/HEL-1573/evidence/`.

## Gate-Chain Implications Checklist

The branch's only gate-chain touch is a 5-line `ALLOWLIST` addition in `scripts/check-tokens.mjs` (`--motion-index`,
`--indicator-x/y/w/h`), a script `.husky/pre-commit` invokes; no `.husky/**` file changes.

- **What does it execute?** `scripts/check-tokens.mjs` is a read-only Node script: it scans frontend CSS/TSX text for
  `var(--x)` references against the declared token set plus the `ALLOWLIST` of runtime-set custom properties. The change
  only adds five allowlist entries (string keys with rationale text); no new code path runs.
- **What environment does it inherit, and from where?** The hook's git environment (including `GIT_DIR` when run from a
  linked worktree) plus the user's shell. The script uses repo-relative paths from its own location and never invokes
  git, so the inherited `GIT_DIR` does not affect it.
- **Does it write anything outside its own sandbox?** No. It only reads source files and prints findings to stdout/stderr;
  it writes no files and mutates no repo state.
- **Does it behave differently from a linked worktree than from a main checkout?** No. It resolves files relative to the
  script's own directory, which is the worktree root in a linked worktree and the checkout root otherwise; verified by the
  isolation test below under a hook-shaped environment.
- **What happens on its first run?** The new entries only make previously-flagged undeclared properties pass. First run
  after the change reports no violations for the motion primitives' inline properties; an unlisted property is still
  reported, so the check keeps failing closed.

## Risks / Trade-offs

- [Grid feel: 280ms vs 180ms reflow, lost placeholder lead] → judge a real drag/resize on the running app; record.
- [Drag regression if our item rule outranks vendor `transition: none`] → D9 re-asserts none states; browser check.
- [FLIP fighting a concurrent CSS transition] → layout slide only on keyed flow lists, never grid items.
- [Tween text width jitter] → tabular numerals already on the metric value (DESIGN.md §3); verify.
- [HEL-1575 merges first touching PanelGrid.css] → second to merge integrates; extend, never duplicate.

## Planner Notes

- Design gate round 2 CONFIRM; its non-blocking notes 1, 3, 4, 6, 7 (skeptic-design-2.md) are executor guidance.
- Design gate round 1 (REFUTE) addressed: D10 entrance window, D9 real vendor states/specificity, D11 Subtle gap
  closed here, D7 stuck skeleton. Standing constraints C1, C2 in tasks.md.
- Self-approved: token names in D2, primitive file locations, consumer choices (rail + segmented control per driver
  brief), keeping `notMerge`. These are design-gate items because HEL-1584 builds on them.
- Not escalated: the HEL-1032 "deliberate 100ms lead" question — the owner-authored AC already chose one duration.

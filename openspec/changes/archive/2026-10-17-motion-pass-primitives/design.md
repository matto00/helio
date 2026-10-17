## Context

See proposal.md. Ground truth surveyed on c8e204e06 (paths under `frontend/src`):

- Tokens (`theme/theme.css` :89-103): `--motion-duration-quick` 160ms, `-standard` 280ms, `-emphasized` 420ms,
  `-highlight` 1200ms, `--motion-stagger` 40ms, `--motion-ease-standard`, `--motion-ease-out`, `--motion-ease-overshoot`
  `cubic-bezier(0.2,0.9,0.3,1.1)` (the Motion II board's palette curve, verbatim), role tokens `--motion-duration-move`
  and `--motion-rise-distance` 6px. Off and OS-reduce-without-preference pin every duration to 0.01ms, stagger to 0ms, rise
  to 0px; Subtle zeroes move/rise and maps overshoot to ease-out. `appearanceTokens.css.test.ts` pins these values.
- Grid: `DesktopPanelGrid.tsx` renders `<Responsive>` with transform positioning; each child is
  `<div key={panel.id} data-short-card><PanelCard/></div>`; RGL spreads `createStyle(pos)` (inline `transform`) last onto
  that div. `PanelGrid.css` :9-47 already times item transform/width/height and the container height on
  `--motion-duration-move` and re-asserts the vendor `transition: none` for dragging/resizing (HEL-1573 D9), so siblings
  already slide on add/remove/resize. `PanelList.tsx` :415-433 swaps `PanelGridSkeleton` → `<PanelGrid key={selectedDashboardId}>`
  via a ternary; the grid remounts on every dashboard switch, warm or cold; a warm switch goes through `panelsRestored`
  (`panelsSlice.ts` :142-153) and may show the skeleton for up to 500ms during the restore read.
  `DesktopPanelGridSkeleton.tsx` :54-57 keys the skeleton `<Responsive>` by dashboard id (HEL-1575 loop invariant).
- Modal (`shared/ui/Modal.tsx`): native `<dialog>`, `showModal()` in an effect; `.ui-modal[open]` runs `ui-modal-in`
  (`--transition-slow`, `backwards`, translateY(6px) scale(0.985)); `::backdrop` has no motion (HEL-1035). No exit motion.
  Under Subtle the 6px rise still runs (`--transition-slow` is not zeroed there) — a DESIGN.md §10 Subtle violation today.
  `e2e/hel1311-heatmap-histogram-charts.spec.ts` :410-422 waits on `animationName === "ui-modal-in"`.
- Palette (`features/commandPalette/ui/CommandPalette.tsx`): a `Modal` mounted once in `App.tsx` and toggled by `open`;
  results are `<li key={action.id}>`, re-rendered per keystroke; CSS adds no animation of its own.
- Detail modal: opened from `usePanelDetailState.handleCardClick(panelId, e)` (desktop) and `MobilePanelStack.handleItemClick`
  (mobile), and from the card menu's Customize (`handleDetail(panelId)`, no event). No source rect is captured.
- Charts: `ChartPanel.tsx` :136-143 keeps `notMerge={true}` (cartesian↔pie stale axis/series crash rationale); series
  carry `name`, never `id` (`features/panels/ui/chartDataOptions.ts`). `applyChartMotion` (HEL-1573 D10) already sets
  `animationDurationUpdate` to the standard token under Full after the entrance, 0 under Subtle, `animation:false` under Off.
- Metric: headline already tweens (`MetricRenderer.tsx` :173-182); `ComparisonLine` delta (:111-124) does not.
- `Crossfade` (`shared/ui/Crossfade.tsx`) mounts `children` only after `loading` ends; route Suspense boundaries are in
  `app/AppRoutes.tsx` (:131/:140/:149/:157) with `PageSuspenseFallback` (a centred spinner).
- Save state: `shared/chrome/SaveStateIndicator.tsx` derives "Unsaved changes" from pending panel updates or
  `hasPendingLayout`; used in `app/dashboardMeta/DashboardMetaFacts.tsx` and `app/CommandBar.tsx`.
- Home timeline: `features/home/ui/TimelineMark.tsx` renders `tl-shape--failed`; marks are keyed
  `${pipelineId}:run:${runId}`, so running → failed is an in-place prop change.
- Guards: `theme/motionTokenGuard.css.test.ts` (no time literal in any `transition:`/`animation:`; pins the CSS file count
  at 149), `shared/motion/motionPrimitiveLiterals.test.ts` (no time/easing literal in any `shared/motion` file, Crossfade or
  `useChartEntranceMotion`), `scripts/check-tokens.mjs` (every `var(--x)` declared or allowlisted).

## Goals / Non-Goals

**Goals:** items 1–5 and 7 on shared primitives and tokens only; Off and OS reduce animate no transform or position on
any of them; Subtle keeps fades and drops translate/scale/overshoot (DESIGN.md §10); no layout-shift or re-render
regression on dashboard load and panel drag, measured before and after.

**Non-Goals:** item 6 (assistant) and item 8 (mobile sheet swipe, pull-to-refresh) pending the owner's split ruling (see
D12); exit/collapse animations (modal close, panel removal fade-out, palette close) — each needs deferred unmount, a
separate decision; the dashboard tab strip and its indicator (HEL-1575); AppRail; pipeline pages and
`OutputPreviewPane` (HEL-1579/1631/1628); the phone nav, chips and mobile dashboard layout (HEL-1583);
`UsageChart` refresh morph (admin page, low payoff — stays `notMerge`); `MetricSparkline` morph (SVG `points` is not
transitionable; follow-up); a skeleton→content sweep beyond the dashboard grid and routes (follow-up); the stale
"Last saved" label after a layout-only save (a pre-existing bug, filed as a follow-up, D11). No new dependency.

## Decisions

**D1. Role tokens.** Add to `:root`: `--motion-lift-scale: 1.01` and `--motion-nudge-distance: 2px`. `:root[data-motion="subtle"]`,
`:root[data-motion="off"]` and the OS-reduce `:root:not([data-motion])` block set them to `1` and `0px` — the D2
(HEL-1573) pattern, so consumers never repeat per-mode selectors. Pinned in `appearanceTokens.css.test.ts`; DESIGN.md
§10's token table gains both rows. Alternative rejected: a literal `scale(1.01)` with Subtle/Off overrides in
`PanelGrid.css` (per-consumer mode selectors, which D2 exists to avoid).

**D2. Drag lift and settle (item 1), CSS only.** In `PanelGrid.css`:
`.panel-grid > .react-grid-item.react-draggable-dragging > .panel-grid-card { transform: scale(var(--motion-lift-scale)); box-shadow: var(--app-shadow-soft); }`
and `.panel-grid-card`'s existing transition list gains `transform var(--motion-duration-move) var(--motion-ease-overshoot)`.
The lift lives on the inner card because the item itself carries RGL's inline transform and the vendor `transition: none`
while dragging. Drop removes the class: the card scales back with the overshoot curve (the "settle with a little give")
while the item glides from the drop point to its snapped cell on the existing item transition. Resize gets the shadow
only (`.resizing > .panel-grid-card`), no scale — scaling a card under the resize handle would misplace the handle visually.
Subtle: scale token is 1 and move duration 0.01ms, so only the shadow fades (`--app-transition`). Off: everything instant.
No `PanelGrid.tsx` / `DesktopPanelGrid.tsx` change for D2. RGL measures the item, not the card, so the scale cannot
affect drag math; `[data-short-card] > .panel-grid-card` keeps the card a direct child.

**D3. Keyed entrance primitive.** New `useKeyedEntrance(keys: readonly string[], options: { playInitial: boolean; later: "pop" | "none" })`
in `shared/motion/useKeyedEntrance.ts`. It returns `entranceOf(key): { phase: "enter" | "pop" | null; index: number }` —
the phase and the stagger index, never a className — plus a separate pure helper `entranceClassProps(entry, { emphasized? })`
that maps an entry to `{ className, style }` (`motion-enter` / `motion-enter--emphasized` / `motion-pop` and
`--motion-index`) for **flow lists only**. The first non-empty `keys` array is latched with a render-time state
adjustment (the `useStaggeredEntrance` pattern, which React resolves in the same pass, adding no commit): when
`playInitial`, initial keys get phase `"enter"` and index = position in that array; a key first seen later gets `"pop"`
(index 0) when `later === "pop"`, `null` when `"none"`. A key that leaves and returns counts as later. Re-renders never
replay; the latch resets only on remount (or a caller-chosen React `key`). `motion.css` gains `.motion-pop` (the
`motion-enter` keyframe on `--motion-ease-overshoot`, standard duration, no delay) and `.motion-enter--emphasized`
(duration `--motion-duration-emphasized`, which DESIGN.md §10 reserves for "panel/card rise only — HEL-1584").
`useStaggeredEntrance` stays as is for `DashboardList`. Unit tests: latch, ordering, later pop/none, no replay on
re-render, a returning key, and that `entranceOf` never yields a className. Covered by `motionPrimitiveLiterals`
automatically. Alternative rejected: index-based `useStaggeredEntrance` for the grid — a panel added mid-array would get
an initial index and wrongly stagger.

**D4. Grid entrance (item 1) — PanelGrid/DesktopPanelGrid change, gate-signed.** Rule: the entrance plays only when the
dashboard's panels arrived from a **network fetch**. Any `panelsRestored` path — a warm tab switch, or the first
activation after a reload restored from the IndexedDB warm store (`warmStore.ts`, `showDashboardPanels.ts`) — is
instant, per HANDOFF.md ("return within the TTL = instant"). There is no "first dashboard of the session" clause.
**At most once per network load.** `panelsSlice` gains `itemsOrigin: "network" | "restored"` and `loadId: number`.
Every reducer that replaces `items` from a server response — `fetchPanels.fulfilled`, `duplicateDashboard.fulfilled`,
`importDashboard.fulfilled` (`panelsSlice.ts` :318-329) — sets `itemsOrigin = "network"` and increments `loadId`; a
duplicated or imported dashboard is a first showing, so it plays the entrance. `panelsRestored` sets `"restored"` and
leaves `loadId` alone. Panels are loaded by `App.tsx` :177-182, which stays mounted across routes, so returning from
Home/Sources/Settings remounts `PanelList` with no fetch and the same `loadId`; that return must not replay. New primitive
`useFirstMountForToken(scope, token)` in `shared/motion/useFirstMountForToken.ts`: a module-level registry
(`Map<scope, Set<token>>`); its `useState` initializer returns `!registry.get(scope)?.has(token)` (pure, so StrictMode's double
initializer agrees), and an effect keyed on `[scope, token]` records **every** token the component sees while mounted —
not only the one at mount. The common edit paths refetch panels while the grid stays on screen (`createPanel`,
`swapPanelOutput`, `duplicatePanel` in `panelThunks.ts`, the unknown-panels refetch in `useLayoutSave.ts`), bumping `loadId` under a mounted `PanelGrid`; those tokens are recorded as seen, so "add a
panel → Home → back" plays nothing. Only a load that arrived while no grid for that dashboard was mounted is unseen. `PanelGrid` computes
`const firstMount = useFirstMountForToken("panel-grid-entrance", dashboardId + ":" + loadId)` (called unconditionally) and `playEntrance = itemsOrigin === "network" && firstMount`
and **latches it once** in a `useState` initializer (PanelGrid is keyed by dashboard id, so the latch lives exactly one
dashboard mount), passing the latched value down. The registry is exported with a test-only reset. Tests: mount →
unmount → remount with the same store plays once; refetch while mounted → unmount → remount plays nothing; a new
`loadId` that arrived while no grid for that dashboard was mounted plays; a restored load never plays. `PanelGrid` also records which shell (desktop or mobile) it first rendered; when a width crossing of `sm`
swaps the shell, a render-time state adjustment (React's "adjust state while rendering", no extra commit) sets the
latched `playEntrance` to `false`, so the newly mounted shell plays no stagger for the panels already shown.
In `DesktopPanelGrid`, one `useMemo` over `resolvedLayout` at the **active** breakpoint
(`getBreakpointFromWidth(rglBreakpoints, width)`, as `shortCardIds` already does) orders panel ids by (y, x) — reading
order — and feeds `useKeyedEntrance(orderedIds, { playInitial, later: "pop" })`. Each grid-item wrapper div gets
`data-entrance={phase ?? undefined}` and `style={{ "--motion-index": index }}` — **never a className from the hook**
(RGL forwards a child className onto the positioned item, `chunk-7ZM5LVH2.mjs:489`, and `.motion-enter` animates
`transform`, which would override RGL's inline translate). The animation runs on the card via
`.panel-grid > .react-grid-item[data-entrance="enter"] > .panel-grid-card` (the `motion-enter` keyframe on
`--motion-duration-emphasized`, stagger delay from `--motion-index`, capped at 10) and `[data-entrance="pop"]` (the
`motion-pop` keyframe). A DesktopPanelGrid test asserts no `.react-grid-item` carries `motion-enter` or `motion-pop`.
`MobilePanelStack` (a flow list, no RGL transform) uses `entranceClassProps(entry, { emphasized: true })` on its
`<article>`, so both shells rise on `--motion-duration-emphasized`. The grid CSS rule declares its own
`--motion-stagger-cap: 10` beside the `min(var(--motion-index), var(--motion-stagger-cap))` delay (the cap is otherwise
declared only inside `.motion-enter`, and an undefined var inside `min()` would invalidate the whole `animation`).
`PanelGrid` mounts only when `items.length > 0` (`PanelList.tsx` :421-433), so a dashboard's first panel always arrives
as a fresh mount with one panel (`enter`, index 0); the test is written that way.
Invariants: no change to `layouts`, breakpoint derivation, cols, width, compactor, handlers or child keys; the HEL-1575
`key={selectedDashboardId}` on `PanelGrid` and the skeleton's dashboard-id key stay; no render changes both layouts and
breakpoint. `PanelCard` props are unchanged (attributes go on the wrapper div), so its `React.memo` is unaffected. The
design gate signed off this touch (skeptic-design-1.md) on the condition above; the PR carries the D13 numbers.

**D5. Grid loading crossfade (item 3).** Inside the always-mounted `panel-list__zoom-container` (its single-wrapper
invariant stays), `PanelList` replaces the ternary with
`<Crossfade loading={showPanelGridSkeleton || showBootstrapSkeleton} skeleton={<PanelGridSkeleton …/>} contentFade={false} block>`
whose children are today's second and third arms unchanged (the keyed `PanelGrid`, or `null`). Exact loading condition:
the existing `showPanelGridSkeleton || showBootstrapSkeleton`. Two new Crossfade options:
- `contentFade` (default `true`): when `false` the content layer gets no fade keyframe — the grid's cards bring their own
  entrance (D4), and a layer fade on top would compound opacity; the content layer comes later in DOM order, so it paints above the skeleton, which fades out underneath the grid (on a
restore that showed the skeleton this reads as a near-cut where cards cover skeleton cards — consistent with
"restore = instant"; judged on screen at the final gate).
- `block` (default `false`): the layers are `display: block` instead of a flex row, so the wrapped content keeps the full
  container width (the RGL root has no width of its own and absolutely positioned children; `.mobile-panel-stack` is a
  width-less flex column; both would shrink to content inside a flex-row layer). A real-browser check at 1440 and 375
  asserts the grid root and the mobile stack are as wide as the zoom container, and the route page (D6) as wide as its
  outlet.
Both RGL instances (skeleton, real grid) may coexist for one standard duration; both keep their dashboard-id keys and
share `useContainerWidth`'s width as today. Crossfade's existing "loading restarts → skeleton returns" covers a cold
switch, and the keyed `PanelGrid` still unmounts while loading, exactly as the ternary does today.

**D6. Route Suspense crossfade (item 3).** New Crossfade option `keepContentMounted` (default `false`): the content layer
is rendered while loading too, as `crossfade__content--pending` (opacity 0, `inert`, `aria-hidden`), so a Suspense
boundary inside it can resolve. In this mode the fades are conditional on the skeleton having **painted**: Crossfade
schedules one `requestAnimationFrame` on mount and records `skeletonPainted`; if loading ends before that frame (a cached
chunk), the skeleton is removed with no fade and the content shows with no `crossfade__content--entering` class. Only a
load that outlives the first frame crossfades. New `RouteSuspense` in `shared/ui/SuspenseFallback.tsx`:
`<Crossfade loading={!ready} skeleton={<PageSuspenseFallback/>} keepContentMounted block><Suspense fallback={null}><ReadySignal onReady={…}>{children}</ReadySignal></Suspense></Crossfade>`,
where `ReadySignal` sets `ready` in a layout effect on its first commit (it commits only once the lazy chunk resolved).
`AppRoutes.tsx`'s four route boundaries use it. Tests (red-capable): pending layer hidden and inert; resolve after the
first frame → both fades; resolve before the first frame → no entering class and no fade (the planned
"already-resolved = no animation" check).

**D7. Modal backdrop and Subtle (item 4, HEL-1035).** In `Modal.css`: `.ui-modal[open]::backdrop { animation:
ui-modal-backdrop-in var(--motion-duration-quick) var(--motion-ease-standard) backwards; }` (opacity 0→1, the sibling
overlays' quick fade; HEL-441 D7 "one entrance in two elements"). `ui-modal-in` keeps its name (e2e waits on it), its
timing and its `scale(0.985)`; its rise becomes `translateY(var(--motion-rise-distance))` (6px, the same value as today).
Add `@keyframes ui-modal-fade-in` (opacity only) and `:root[data-motion="subtle"] .ui-modal[open] { animation-name:
ui-modal-fade-in; }` — the HEL-1573 D11 drawer/sheet/toast pattern — so Subtle fades in place with no rise or scale. Off and
OS reduce collapse every duration to 0.01ms through the tokens (the global `*` rule does not reach `::backdrop`; the token
does). The scrim's `backdrop-filter: blur(2px)` is not animated. HEL-1035's open question (is an instant scrim deliberate
for a modal?): fade — DESIGN.md's one-entrance ruling names the drawer and sheet as the reference, and an instant scrim
under a rising dialog reads as two events. Reversible: one rule.

**D8. Card expands into the detail modal (item 4).** New primitive `expandFrom(element, origin)` in
`shared/motion/expandFrom.ts` — a plain function, not a layout-effect hook, because the dialog only gains a box when
`Modal`'s **passive** "sync open" effect calls `showModal()` (a layout effect would measure a `display: none` dialog). It
reads `--motion-duration-standard` and `--motion-ease-out`; if the duration is instant/unresolved, `origin` is null, or
the element is not `open`, it returns without an animation call. Otherwise it measures the open dialog and runs one Web
Animation: from `translate(dx, dy) scale(s)` (centre of origin to centre of dialog, uniform `s = origin.width /
dialog.width`, clamped to [0.2, 1]) to `none`, `fill: "none"` (no lingering transform — HEL-313's portalled popovers).
`Modal` gains an optional `expandFrom?: DOMRectReadOnly | null` prop:
- At **render**, the dialog's className includes `ui-modal--expanding` when `expandFrom && useMotion() === "full"`, so the
  class is present before `[open]` is applied and `ui-modal-in` never starts. Its CSS swaps the animation to
  `ui-modal-fade-in` (opacity only), so the WAAPI transform and a CSS transform never stack.
- In the existing "sync open" effect, immediately after the `if (!dialog.open) dialog.showModal()` line opens the dialog,
  it calls `expandFrom(dialog, expandFrom)`. Under dev StrictMode (`main.tsx` :113) the simulated unmount closes the dialog,
  so the re-run opens it again and calls `expandFrom` twice; the second animation replaces the first (harmless). Unit
  tests asserting "called once" render without StrictMode.
Subtle/Off: no class, no call; the ordinary entrance applies (a fade under Subtle per D7). `usePanelDetailState` stores
the origin rect: from `e.currentTarget.getBoundingClientRect()` in `handleCardClick`, and for Customize (no event) from
the card found by `[data-panel-id="<id>"]` (added to `PanelCard`'s `<article>`); mobile `handleItemClick` likewise.
`DesktopPanelGrid` / `MobilePanelStack` pass it to `PanelDetailModal` → `Modal` (a prop pass-through only). Close stays
instant (non-goal). Unit tests with a mocked `animate`: called once under Full with the computed transform; never called
while `dialog.open` is false (red-capable against a layout-effect implementation); not called under Subtle/Off/null/
instant; `ui-modal--expanding` present on the first render under Full with an origin.

**D9. Palette (item 5).** `CommandPalette.css`: `.command-palette.ui-modal[open] { animation: command-palette-in
var(--motion-duration-standard) var(--motion-ease-overshoot) backwards; }` with `from { opacity: 0; transform:
translateY(calc(-1 * var(--motion-rise-distance))); }` — a 6px drop from above with the board's overshoot curve (the
board's 0.97 scale is dropped, as HEL-1573 D2 dropped scale from rises). Subtle: rise 0px, overshoot → ease-out, so a
fade either way: D7's Subtle rule (specificity 0,4,0) outranks the palette rule (0,3,0) and swaps in `ui-modal-fade-in`,
and the palette keyframe itself would resolve to a fade under Subtle's tokens. Off/OS reduce: 0.01ms. Backdrop: inherited from D7. Results: `useKeyedEntrance(visibleIds, { playInitial: true,
later: "none" })` inside a results subtree keyed by an open counter, so each open staggers and per-keystroke results
appear without a rise. Stagger step: a new `--motion-stagger-tight: 30ms` token (the ticket's and the board's step), zeroed
under Off and OS reduce exactly like `--motion-stagger`, pinned in `appearanceTokens.css.test.ts`. The palette rule declares its own
`--motion-stagger-cap: 7`, so the last row starts by about 210ms. Each group label takes its group's first row's class and
`--motion-index`, so a heading is never visible over rows that have not started.

**D10. Chart morph on refresh (item 2).** `features/panels/ui/chartDataOptions.ts` gives every series a stable `id`
(`${chartType}:${seriesName}`, index-suffixed on a duplicate name). `ChartPanel` computes a **shape signature** per
option: the whole option structure with only data payloads stripped — `series[].data`, category-axis `data`,
`dataset.source` if used, and data-derived `visualMap` `min`/`max` (heatmap) — serialised deterministically, with each
function value replaced by its source text (`fn.toString()`), so a rebuilt-but-identical formatter matches and a
different formatter does not. It compares against the **last committed** signature, stored in a ref updated in an effect (never during render,
so StrictMode's double render cannot make a first mount look unchanged): `notMerge` is `true` when the signature changed
(or on first render); `false` with `replaceMerge={["series"]}` only when nothing but data changed. Any config edit —
removing an axis `name`, a `min`/`max`, a label formatter, a legend option — therefore fully replaces, so no stale nested
option can survive (the F-027 class `notMerge` exists to prevent). Same-data-shape refreshes update in place and ECharts
animates the update on `animationDurationUpdate` (the standard token under Full, 0 under Subtle, `animation:false` under
Off — unchanged HEL-1573 D10 policy). The entrance window logic is untouched. Unit tests: same-shape data refresh →
merge; every type switch (bar↔pie, line↔heatmap, histogram, scatter) → notMerge; same type with an axis name or `min`
removed → notMerge; formatter identity change with identical source → merge. `UsageChart` and `OutputPreviewPane` keep
`notMerge={true}`. Metric: `ComparisonLine`'s numeric magnitude goes through `useValueTween` with the same formatter and
screen-reader final-value rule as the headline (HEL-1573 D6).

**D11. Feedback (item 7).** New primitive `useOneShotOnChange(value, isTarget)` in `shared/motion/useOneShot.ts`: returns
`{ active, done }`, `active` true from the first commit where `value` changed into a target state while mounted (never on
mount), until `done` (wired to `onAnimationEnd`, or to the next state change).
(a) **Save check — keyed to a successful save, not to "clean".** `dashboardsSlice` gains `layoutSaveSeq` (incremented in
`updateDashboardLayout.fulfilled`) and `panelsSlice` gains `panelSaveSeq` (incremented in `updatePanelsBatch.fulfilled`).
`SaveStateIndicator` watches `layoutSaveSeq + panelSaveSeq`: when it increases while mounted, a `Check` icon renders beside
the label with `motion-pop` (Full: overshoot rise; Subtle: fade; Off: static), and it stays until the next dirty
transition — no timer, so no literal duration. The sequences are global, so a flush save of dashboard A that settles after switching to B shows the check on B's
indicator — accepted (a save did just succeed). An undo back to the persisted layout, a server re-baseline, a discarded
staged drag, or `resetPanelSaveState` all clear "dirty" without a save and show no check (`useLayoutSave.ts` :220-229).
Tests: save fulfilled → check; undo to clean → no check; mount clean → no check.
(b) **Failed run nudge.** `TimelineMark`: a mark whose status changes to `failed` while mounted gets `tl-shape--nudge` once: a
keyframe `rotate(45deg) translateX(var(--motion-nudge-distance))` → `rotate(45deg) translateX(calc(-1 *
var(--motion-nudge-distance)))` → `rotate(45deg)` on `--motion-duration-standard` / `--motion-ease-out` (the diamond's
existing `rotate(45deg)`, `HomePage.css`, is repeated in every frame). Subtle/Off: nudge distance 0px, so no movement. A
mark mounted already failed never nudges. The pre-existing stale "Last saved" label after a layout-only save is filed as
a follow-up, not fixed here.

**Patch-set / proposal apply.** The patch-set apply runs on `PatchSetReviewPage` (a separate route, `AppRoutes.tsx` :145),
which starts a `fetchPanels` without awaiting it and navigates to the dashboard. Depending on whether that fetch lands
before or after the grid mounts, the user sees either only the new panels pop in or the whole grid stagger once; both
satisfy the spec, and neither replays afterwards.

**D12. Items 6 and 8 — escalated split.** Recommendation (raised to the owner, not decided here): item 6 → a follow-up
blocked on the assistant queue (D4's `later: "pop"` animates any panel added to a mounted grid; after an apply, which navigates from a
separate review route, the result is timing-dependent — new panels pop, or the grid staggers once); item 8 → HEL-565 stays the vehicle for sheet swipe after HEL-1583 merges, plus a pull-to-refresh follow-up
blocked by HEL-1583. This design is revised before the design gate if the owner rules otherwise.

**D13. Performance proof.** `e2e/hel1584-motion-perf.spec.ts` (Chromium, Full, 12-panel seeded dashboard, at most 2
workers): an init script counts React commits through `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`; a
`PerformanceObserver` records `layout-shift` (CLS) and `longtask`; a cold dashboard load records commits, CLS, long-task
total and **time to first card content** (first `.panel-grid-card` whose body has no skeleton); a scripted drag of one
card across three cells records commit count and rAF frame intervals (p50/p95/max). **Baseline method:** the spec is
written and run in this worktree **before any source change** (tasks 1.1-1.3), 5 runs on the unmodified tree ("before"),
then 5 runs on the branch head ("after"). `e2e/hel1575-switch-measurement.spec.ts` is also run 5× before and after, warm
and cold medians recorded. Medians and base min-max spreads go to `.concertino/runs/HEL-1584/evidence/perf.md` and the PR.
**Pass/fail thresholds** ("noise" = the base run's min-max spread):
- load commits: after ≤ before + the named commits this change adds (expected: +1, Crossfade's `skeletonGone` state; any
  other extra commit fails unless explained by name in perf.md and accepted at the final gate);
- drag commits: after = before (D2 is CSS-only; D4 adds no state on drag);
- CLS (load and drag): after ≤ before + 0.001;
- time to first card content: after median ≤ before median + max(spread, 17ms);
- long-task total (load): after median ≤ before max;
- drag p95 frame interval: after ≤ before + max(spread, 17ms); max frame interval no new outlier above before max + 17ms.
**Expected move in `hel1575-switch-measurement`:** that spec's "skeletons === 0" readiness proxy will rise by about one
`--motion-duration-standard` (280ms) on a cold switch and on a warm restore that showed the skeleton, because the
outgoing skeleton layer (aria-hidden, inert) stays mounted while it fades. This is the crossfade itself, not slower
content: time to first card content is the authoritative readiness metric and is held to the threshold above. The spec
is not edited; perf.md reports both numbers side by side. A warm switch that never showed the skeleton must not move
beyond its spread. A jest `<Profiler>` test pins `DesktopPanelGrid`'s commit count for mount and one drag start/stop to
the base values. A threshold miss is a FAIL, not a note.

**D14. Real-browser proof.** `e2e/hel1584-motion-surfaces.spec.ts`, reusing `e2e/support/motionRecorder.ts` and
`motionPrimitivesSeed.ts`: for grid (entrance, drag lift/settle, add pop), modal (backdrop, expand-from), palette (entrance,
results), under Off and under OS reduce with no saved choice (`motion: null`), light and dark: no running animation or
transition on transform/translate/scale/position longer than 0.01ms; a Full control on the same selectors must show
them animating (so the check can go red). Subtle: opacity only. A warm tab switch, a dashboard → Home → dashboard round trip, and an add-panel → Home → back round trip play no grid entrance. Evidence
(screenshots, motion logs) to `.concertino/runs/HEL-1584/evidence/`; Playwright `outputDir` in the run's scratch dir.

## Gate-Chain Implications Checklist

Expected gate-chain touch: none beyond what HEL-1573 already allowlisted. If a JS-set custom property is added to CSS
(none is planned: `--motion-index` is already allowlisted), `scripts/check-tokens.mjs`'s `ALLOWLIST` gains it, and this
checklist is re-answered with an isolation transcript before Delivery.

- **What does it execute?** Nothing new; `.husky/**` and the scripts it invokes are unchanged by this plan.
- **What environment does it inherit, and from where?** Unchanged.
- **Does it write anything outside its own sandbox?** No.
- **Does it behave differently from a linked worktree than from a main checkout?** No change.
- **What happens on its first run?** No change.

## Risks / Trade-offs

- [Merge path leaves stale chart state] → D10 signature forces a full replace on any shape change; unit test per chart-type
  switch (bar↔pie, line↔heatmap, histogram toggles) asserting `notMerge` true; real-browser refresh check.
- [Two RGL instances during the grid crossfade] → bounded by one standard duration; both keyed; the HEL-1575 loop test and
  `hel1575-switch-measurement.spec.ts` must stay green; D13 measures it.
- [Entrance replays on warm switches] → D4 origin flag; e2e asserts no entrance on a warm switch.
- [Expand-from on a scrolled/zoomed grid] → origin is a viewport rect at click time; dialog is viewport-fixed; zoom only
  changes the rect. Clamp avoids a degenerate scale.
- [Siblings (HEL-1583, HEL-1628) edit `motionTokenGuard.css.test.ts`'s file count] → second to merge re-counts; never
  hand-merge the number.
- [`ui-modal-in` name dependency] → name kept; hel1311/hel510 specs stay green.
- [HEL-1583 (PR #1052) also edits `PanelList.tsx` (zoom region), `theme.css`, `MobilePanelStack.css`, the
  SaveStateIndicator hosts and the guard file] → different regions; whichever merges second rebases, never redesigns.
- [Detail-modal geometry specs (`hel716-panel-detail-tall-viewport-footer`, `hel909`, `hel572`) measure during the new
  WAAPI expand] → named must-stay-green in task 6.6; fix by waiting on `dialog.getAnimations()`, never by weakening.
- [Drag lift reads flat: `--app-shadow-soft` is already the hover shadow] → judged on screen (6.5); if flat, add an
  `--app-shadow-lift` token in both themes (a token definition, reversible) rather than a literal.

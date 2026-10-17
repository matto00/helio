## Why

HEL-1573 shipped the motion tokens, the one effective-motion reader (`useMotion()`), and five primitives, each with a
single consumer. Most of Helio still changes state with a hard cut: a dashboard pops in fully formed, a dragged panel
has no weight, a chart redraws from scratch on every refresh, the modal scrim appears on frame 1 while its dialog
rises (HEL-1035), and the palette has no entrance of its own. The owner's brief is "motion with a little give", not
decoration (HANDOFF.md). This change applies the foundation to the surfaces with the highest payoff, behind the
existing Full / Subtle / Off setting and OS reduced motion.

## What Changes

- **Panel grid (item 1):** a lift on drag (shadow, plus a ~1.01 scale through a new role token zeroed under Subtle/Off) and an
  overshoot settle on drop; a staggered card entrance when a dashboard loads cold (not on a warm tab restore); a single
  pop-in for a panel added while the grid is mounted. Siblings already slide to their new spots on add, remove and resize
  through react-grid-layout's token-timed transforms (HEL-1573 D9); this change proves it in a real browser and keeps it.
- **Data refresh (item 2):** chart panels morph on a same-shape data refresh (ECharts merge path with stable series ids)
  instead of a full replace; a shape change (chart type, axes, components) still fully replaces. The metric comparison
  delta tweens alongside the already-tweened headline value.
- **Loading (item 3):** the dashboard skeleton grid crossfades into the real grid in place; the route-level Suspense
  fallback crossfades into the lazy route.
- **Panel → detail modal (item 4):** the modal grows out of the clicked card's rect (Full), and every `Modal`'s backdrop
  fades in as one entrance with its dialog (closes HEL-1035). Under Subtle the modal fades in place (no rise).
- **Command palette (item 5):** its own entrance: the panel drops in from above with the overshoot curve, results stagger
  on each open (not on every keystroke).
- **Feedback (item 7):** a small check pops in beside the save state when a pending layout/panel save completes; a run
  mark on the Home 24h timeline nudges once when it turns failed while on screen.
- **Primitives extended (`shared/motion`, `shared/ui/Crossfade`)**: a keyed entrance (stagger initial keys, optional pop for
  later keys), an expand-from-rect (container transform), a one-shot nudge, and two Crossfade options (keep content
  mounted while loading, for Suspense; skip the content fade when content brings its own entrance). New role tokens
  `--motion-lift-scale` and `--motion-nudge-distance`, zeroed under Subtle/Off/OS reduce like `--motion-rise-distance`.
- **Split, pending owner ruling (escalated):** item 6 (assistant: on owner hold) and item 8 (mobile sheets / pull-to-refresh:
  overlaps the running HEL-1583). Recommendation: follow-up tickets; HEL-565 stays open as the vehicle for sheet swipe.
- Performance: before/after numbers for dashboard load and panel drag (React commit counts, commit durations, CLS,
  long tasks, drag frame intervals) recorded as evidence and in the PR.

## Capabilities

### New Capabilities
- `surface-motion`: where and how the motion system is applied to product surfaces (panel grid, chart refresh,
  loading swaps, modals and the detail modal, command palette, save/run feedback), and how each behaves under Full,
  Subtle, Off and OS reduced motion.

### Modified Capabilities
- `motion-primitives`: adds the keyed entrance, expand-from-rect and one-shot nudge primitives, two Crossfade options,
  and the `--motion-lift-scale` / `--motion-nudge-distance` role tokens.

## Impact

- Frontend only; no API, schema or backend change. No new dependency.
- Files: `frontend/src/shared/motion/**`, `shared/ui/Crossfade.*`, `shared/ui/Modal.*`, `shared/ui/SuspenseFallback.tsx`,
  `app/AppRoutes.tsx`, `theme/theme.css` (+ its token tests), `features/panels/ui/grid/{PanelGrid.css,DesktopPanelGrid.tsx,
  usePanelDetailState.ts,MobilePanelStack.tsx}`, `features/panels/ui/{PanelList.tsx,PanelCard.tsx,ChartPanel.tsx}`,
  `features/panels/state/panelsSlice.ts` (cold/warm origin flag), `features/panels/ui/chartDataOptions.ts` (series ids),
  `features/panels/ui/renderers/MetricRenderer.tsx`, `features/panels/ui/detailModal/PanelDetailModal.tsx`,
  `features/commandPalette/ui/CommandPalette.{tsx,css}`, `shared/chrome/SaveStateIndicator.*`,
  `features/home/ui/TimelineMark.tsx` (+ css), `DESIGN.md` §10, guards (`motionTokenGuard` CSS file count,
  `scripts/check-tokens.mjs` allowlist if a JS-set property is added), e2e specs.
- Not touched: the dashboard tab strip, AppRail, pipeline pages, phone nav / chips / mobile dashboard layout, assistant UI.

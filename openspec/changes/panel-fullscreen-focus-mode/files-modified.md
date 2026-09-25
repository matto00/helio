## Files modified — HEL-584 panel fullscreen/focus mode

- `frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx` — new component: view-only, maximized
  panel content overlay wrapping the shared `Modal` (`size="full"`), fed the caller's existing
  `usePanelData` result as props (design.md Decision 2, never a second fetch), gates its `PanelContent`
  body on `open` so a closed overlay never pays for a hidden second chart/ECharts instance while still
  letting `Modal`'s own `[open]` effect (showModal/close + focus capture/restore) see a real toggle.
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.css` — new: `.panel-fullscreen-overlay`
  definite-height override (design.md Decision 1a) so `Modal`'s `size="full"` shrink-to-fit default
  doesn't collapse the chart/table content area; `.panel-fullscreen-overlay__body` fills that box so
  `PanelContent`'s own `flex: 1` has a real flex parent.
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.css.test.ts` — new: static-source-parse test
  (this repo's established convention — Jest's CSS-module mock and jsdom's lack of real layout both make
  a render + `getComputedStyle` assertion impossible) proving the definite-height rule exists.
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.test.tsx` — new: standalone render test (title +
  content, mono eyebrow, view-only — no editing controls), Esc/close-button/backdrop-click →
  `onClose` behavior, a static source check that the component never calls `usePanelData` itself (only
  imports its `PanelDataResult` type), and a chart-resize wiring test (mirrors `ChartPanel.test.tsx`'s own
  `echarts-for-react` mock) proving `ChartPanel` reaches `ReactECharts` with `autoResize={true}` unmodified
  inside the overlay — jsdom implements no `ResizeObserver`/real layout, so this plus the CSS test above is
  the achievable mechanical evidence for design.md Decision 5, documented as such in-file.
- `frontend/src/features/panels/ui/PanelCard.tsx` — adds a "Fullscreen" `IconButton` to the header actions
  (gated on `isFullscreenEligible(panel)`), `isFullscreenOpen` state, and mounts
  `PanelFullscreenOverlay` unconditionally (once eligible) fed the SAME `panelData` result
  `PanelCardBody` already receives.
- `frontend/src/features/panels/ui/PanelCard.test.tsx` — new `HEL-584` describe block: button
  present/absent per eligible/excluded kind, opening shows matching content via the shared renderer
  (scoped to the dialog), no editing controls in the overlay, Esc closes + restores focus to the trigger
  (red-first — see below), and an output-panel test proving no additional `getOutputRows` fetch fires when
  opening fullscreen (design.md Decision 2). Also fixes one pre-existing test
  (`frozen=true still short-circuits...`) whose `screen.getByText("Revenue")` became ambiguous now that the
  overlay's always-mounted `Modal` header also renders the panel title as an `<h2>`.
- `frontend/src/features/panels/state/panelNarrowing.ts` — adds `isFullscreenEligible(panel)` (excludes
  `divider`/`form`, matching design.md Decision 3), reused by both `PanelCard.tsx` gates.
- `openspec/changes/panel-fullscreen-focus-mode/tasks.md` — all tasks marked complete.
- `frontend/src/theme/elevationTokenGuard.css.test.ts`,
  `frontend/src/theme/motionTokenGuard.css.test.ts` — bumped the pinned "walks every CSS file"
  count (117 → 118) for the new `PanelFullscreenOverlay.css`, which declares neither
  box-shadow/border-radius nor motion/transition/animation, so no new pin was needed in either
  guard — caught by `npm test` (not `npm run lint`/`format:check`), see gate results below.

## Red-first evidence (Standing Constraint C4)

The `PanelCard — HEL-584 fullscreen/focus mode` describe block in `PanelCard.test.tsx` was written and run
against `PanelCard.tsx` BEFORE the Fullscreen control/overlay wiring existed:

```
Test Suites: 1 failed, 1 total
Tests:       7 failed, 25 skipped, 2 passed, 34 total
```

(the 2 passing were the "no Fullscreen control for divider/form" cases, trivially true before the button
existed). After implementing `PanelFullscreenOverlay.tsx`/`PanelCard.tsx`:

```
Test Suites: 1 passed, 1 total
Tests:       35 passed, 35 total
```

## Root cause note (systematic-debugging.md) — two implementation-design bugs caught during red→green

1. **Symptom:** `PanelFullscreenOverlay` initially accepted no `open` prop and was conditionally
   mounted/unmounted by `PanelCard` (mirroring `PanelDetailModal`'s convention). Esc-closing it left
   `document.activeElement` on the dialog instead of restoring it to the trigger button.
   **Root cause (probe-confirmed):** `Modal`'s focus-restore logic lives in the `else` branch of a
   `useEffect(() => {...}, [open])` — it only runs when `open` transitions `true → false` on an
   ALREADY-MOUNTED instance. Unmounting the whole overlay (rather than toggling `open`) never re-runs that
   effect with `open: false`, so the restore branch never executes. Probe: adding the mount/unmount version
   and running the Esc test showed `document.activeElement` staying inside the (about-to-be-removed) dialog
   instead of moving to the trigger.
   **Fix:** mount `PanelFullscreenOverlay` unconditionally (gated only on kind-eligibility) and pass a
   genuine `open` boolean prop through to `Modal`, matching `QuickLauncherOverlay`'s established
   always-mounted-with-a-toggled-`open`-prop precedent instead of `PanelDetailModal`'s (which has no
   `panel` prop to render at all when nothing is selected — a different constraint that doesn't apply
   here). To avoid paying for a second, hidden `ChartPanel`/ECharts instance per dashboard panel at all
   times, the overlay's own body (`PanelContent`) is gated on `open` internally — the `Modal` shell/header
   stays always-mounted (cheap), only the expensive content mounts/unmounts with `open`.
2. **Symptom:** `PanelCard.test.tsx`'s pre-existing `frozen=true still short-circuits...` test started
   failing (`getByText("Revenue")` found 2 elements) once the overlay was wired in.
   **Root cause:** `Modal` always renders its header (`<h2>{title}</h2>`) into the DOM regardless of the
   native `open` attribute — the always-mounted overlay's title duplicates the card's own `<h3>` title text
   node, which a real browser hides visually (`dialog:not([open]) { display: none }`) but which jsdom
   still returns from a DOM query.
   **Fix:** scoped that pre-existing assertion to the card's own `.panel-grid-card__title` element instead
   of a bare `getByText`.

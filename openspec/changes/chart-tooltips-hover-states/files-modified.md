# Files Modified — HEL-566

- `frontend/src/utils/chartAppearance.ts` — extended `ChartThemeTokens`/`resolveChartTheme()` with
  `shadowSoft`/`radiusMd`/`accentStrong`; added `prefersReducedMotion()`; switched the tooltip's
  `textStyle.fontFamily` to mono and added `extraCssText` (shadow/radius); added
  `applyAxisTriggerTooltip()` (D3: axis-trigger tooltip for bar/line with `series.length > 1`) and
  `applyHoverEmphasis()` (D4: subtle `--app-accent-strong`-colored hover emphasis, reduced-motion
  aware) as post-merge passes over the final series array.
- `frontend/src/features/panels/ui/ChartPanel.tsx` — destructures `accentColor` from `useTheme()`
  and adds it to the option-building `useMemo`'s dependency array (D5); calls
  `applyAxisTriggerTooltip`/`applyHoverEmphasis` as post-merge passes after `applyChartTypeOptions`,
  reusing one `resolveChartTheme()` read per memo recompute. **Cycle 2 (skeptic-final-1 CR1 fix):**
  adds `themeSyncTick` state + a `requestAnimationFrame`-deferred `useEffect` keyed on
  `theme`/`accentColor`, and adds `themeSyncTick` to the option `useMemo`'s dependency array — see
  "Cycle 2" section below for the root cause and probe.
- `frontend/src/utils/chartAppearance.test.ts` — updated the tooltip theme-wiring assertion (mono,
  not sans font); added tests for the new `shadowSoft`/`radiusMd`/`accentStrong` tokens,
  `prefersReducedMotion()`, `applyAxisTriggerTooltip()` (multi/single-series bar/line, pie, scatter),
  and `applyHoverEmphasis()` (animated and reduced-motion cases).
- `frontend/src/features/panels/ui/ChartPanel.test.tsx` — added component-level tests: tooltip
  extraCssText/mono-font wiring, axis-trigger tooltip for a multi-series bar chart placed through
  `ChartPanel`, item-trigger unchanged for single-series, hover-emphasis colors on rendered series.
  **Cycle 2 (skeptic-final-1 CR2 fix):** replaced the original task-3.2 call-count-only spy test
  (which passed even when the rendered value was stale — "evidence-shaped non-evidence") with two
  tests in a new `"theme/accent toggle without remount"` describe block that mock
  `resolveChartTheme()`'s return value from a REAL, JS-visible signal `ThemeProvider` actually
  mutates (`document.documentElement`'s `data-theme` attribute; `applyAccentTokens`'s real inline
  `--app-accent` custom property) and assert the RENDERED option (the object passed to the mocked
  `ReactECharts`) reflects the new theme/accent value after a toggle, not merely that the resolver
  was called again.

## Debugging note (not a bug fix — pre-emptive guard correction)

`prefersReducedMotion()`'s initial implementation only guarded `typeof window === "undefined"`.
Running the full `chartAppearance|chartTypeOptions|ChartPanel` test subset surfaced 62 failures in
unrelated tests (`ChartRenderer` etc., anything mounting `ChartPanel`) with
`TypeError: window.matchMedia is not a function` — jsdom's `window` exists but does not implement
`matchMedia` at all. Root cause: the guard checked the wrong condition (`window` presence, not
`matchMedia`'s existence). Probe: reproduced deterministically via the failing test's stack trace
pointing straight at `chartAppearance.ts:82`; found the exact same class of guard already solved
identically in `frontend/src/shared/ui/Toast.tsx`'s own private `prefersReducedMotion()` (`typeof
window === "undefined" || typeof window.matchMedia !== "function"`), confirming both the cause and
the fix shape. Fixed by matching that guard exactly; full suite green after.

## Live verification (task 4.2)

Ran a throwaway Playwright spec (not committed) against `scripts/concertino/start-servers.sh`
(DEV_PORT 5998, BACKEND_PORT 8905) seeding a two-series bar-configured Output via the API, placed
via the Add-panel picker. Confirmed, with screenshots retained under
`.concertino/runs/HEL-566/evidence/` (gitignored):

- Dark theme, in-grid: themed tooltip (dark surface/border/shadow), axis-trigger tooltip listing
  both series ("A"/"B") at the hovered x, mono numeric values.
- Light theme + Blue accent (via `/settings`), in-grid: tooltip re-themed to light surface/border,
  no remount (same panel, same data).
- Light theme + Blue accent, inside `PanelFullscreenOverlay` (HEL-584): same themed tooltip and
  axis-trigger behavior, confirming `ChartPanel` reused unmodified in the fullscreen modal per the
  ticket's constraint.

## Cycle 2 — skeptic-final-1 REFUTE (theme toggle does not re-resolve tooltip while mounted)

**Root cause (one sentence, naming the failing layer):** `ChartPanel`'s option `useMemo` recomputes
during the SAME React render pass that a `theme`/`accentColor` context change triggers, but
`ThemeProvider`'s own `useEffect` — the thing that actually mutates
`document.documentElement.dataset.theme` (and, via `applyAccentTokens`, the `--app-accent*` inline
custom properties) — runs strictly AFTER the render phase of that commit, so `resolveChartTheme()`'s
live `getComputedStyle` read captures the PREVIOUS theme/accent's values; since a passive DOM
mutation performed in an effect never itself triggers a further React render, the chart's tooltip
styling stays exactly one toggle behind forever (dark→light shows dark; the following light→dark
then shows light — an off-by-one-render lag, not a one-off timing fluke).

**Probe (exact commands/snippet):** a minimal RTL harness — `ThemeProvider` wrapping a `Probe`
component that reads `useTheme()` and, DURING ITS OWN RENDER (mirroring exactly what
`resolveChartTheme()` does inside `ChartPanel`'s memo), records
`document.documentElement.getAttribute("data-theme")`; a same-commit child `useEffect` keyed on
`theme` records the same read; a `requestAnimationFrame`-deferred read (scheduled from an effect)
records it a third way. Clicked a `toggleTheme()` button and compared all three.

**Probe output:**
```
before toggle -> { theme: 'dark', attr: null }
all renders after toggle click -> [
  { theme: 'light', attr: 'dark', source: 'render' },        // STALE — proves the render-time race
  { theme: 'light', attr: 'dark', source: 'child-effect' },  // STALE — proves a same-commit child
                                                              //   effect does NOT fix it either
                                                              //   (passive effects fire child-before-
                                                              //   parent within one commit)
  { theme: 'light', attr: 'light', source: 'raf-after-effects' }, // CORRECT — proves the fix mechanism
  { theme: 'light', attr: 'light', source: 'render' }        // the forced follow-up render, now correct
]
FINAL document.documentElement data-theme attribute -> light
```

**Fix:** `themeSyncTick` — a small `useState(0)` bumped from a `useEffect` keyed on
`[theme, accentColor]` via `requestAnimationFrame` (cancelled/rescheduled on rapid re-toggles via the
effect's cleanup), added to the option `useMemo`'s dependency array. rAF fires after the browser
paints — i.e. after every effect of the triggering commit, ancestor (`ThemeProvider`) and descendant
alike, has already run — so by the time `themeSyncTick` bumps and forces the corrective recompute,
`document.documentElement` is guaranteed to already reflect the new theme/accent.

**Red-before-green, twice over:**
1. Unit-level: `git stash` on just `ChartPanel.tsx` (keeping the new/strengthened
   `ChartPanel.test.tsx` tests) → both new tests failed with the exact stale-value assertion
   mismatch; `git stash pop` → both pass.
2. Live-browser: a throwaway Playwright spec (not committed) driving the real dev server
   (`scripts/concertino/start-servers.sh`, DEV_PORT 5998/BACKEND_PORT 8905), toggling theme via the
   command palette (`Ctrl+K` → "Switch to \<theme\> theme" — the skeptic's own repro mechanism,
   which never navigates away and thus never remounts `ChartPanel`) in both directions, reading the
   real tooltip DOM node's live `getComputedStyle`. Against pre-fix code: `data-theme` correctly
   flips to `light` but the tooltip's `backgroundColor` stays `rgb(38, 35, 32)` (dark) — the exact
   defect reproduced live. Against the fix: dark → light → dark all resolve correctly
   (`rgb(38,35,32)` → `rgb(255,255,255)` → `rgb(38,35,32)`, shadow/border/font all matching too),
   confirmed in both directions, panel `<article>` node never remounted (`elementHandle()` identity
   checked before/after).

**Non-blocking note carried forward, not fixed (pre-existing, HEL-566-unrelated):** confirmed
independently during this cycle's live re-verification — a panel placed via the "Add panel" picker
does not get `appearance.chart` populated automatically, so none of this ticket's (or F-025's
pre-existing) tooltip theming engages until `appearance.chart` is set explicitly (worked around in
both live-verification passes by `PATCH`ing the panel directly, matching the skeptic's own
workaround). Worth a follow-up ticket.

## Spinoff candidate (not fixed here, out of this ticket's scope)

`prefersReducedMotion()` now exists as three near-identical private implementations
(`chartAppearance.ts`, `Toast.tsx`, and `useIsNarrowerThan.ts`'s own `matchMedia` guard pattern).
Design.md Decision 4 explicitly scoped this ticket's copy to `chartAppearance.ts` (not a shared
utility), and CONTRIBUTING.md's refactor discipline says a focused change shouldn't fold in an
unrelated extraction — worth a follow-up ticket to consolidate into one shared
`useReducedMotion`/`prefersReducedMotion` utility.

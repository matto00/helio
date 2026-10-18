## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD `d8387507734f8e74bbf62df8880923791ec7c08d` (main tip; change dir is untracked planning only).

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=bug/accent-hover-contrast-light/hel-1669`.
- **Root cause is real** (`frontend/src/theme/appearance.ts:611-634`, `theme.css:379-380`): `buildAccentTokens` picks the
  ink with a theme-independent comparison of `#181511` / `#fdfcfa`, writing only accent/ink/focus-ring/accent-text/selection.
  `--app-accent-strong` is the static light `color-mix(... 76%, black)`, which mixes toward the dark runtime ink.
- **D1 numbers, independently recomputed.** I ran a numpy sweep of the FULL 256^3 sRGB cube, not the artifact's step-3 grid
  (scratchpad `sweep.py`). It reuses the code's ink choice, the WCAG luminance from `appearance.ts:152`, and JS `Math.round`
  mixing like `lightenTowardWhite` / `darkenTowardBlack`.
  - Fixed mix away from the ink, 22% in dark: the minimum ink-on-strong ratio is **4.83**, at `#f50000`. Zero accents fall below 4.5.
  - Fixed mix away from the ink, 24% in light: the minimum is **4.93**, at `#f50000`. Zero accents fall below 4.5.
  - The step-3 grid reproduces the artifact's own 4.86 / 4.96 at `#f60000`, so its numbers are correct for the grid it states.
  - Hover is never below rest anywhere in the cube. The minimum difference is exactly 0, at no-op mixes such as `#ffffff`.
  - A step-up loop really is unreachable, so removing it is correct.
- **The mutation is demonstrable.** The old "toward black in light" behaviour leaves 4,757,314 accents below 4.5. The guard
  will go red against it.
- **Presets and defaults.** Light hover, new vs old:

  | Accent | Light hover, new | Light hover, old |
  | --- | --- | --- |
  | `#f97316` (Orange) | 8.21 | 3.93 |
  | `#ea580c` | 6.80 | 3.21 |
  | `#a855f7` (Purple) | 6.51 | 2.95 |

  - Every other preset is 6.42 or higher.
  - Dark values are identical to today's 22%-white mix for every preset (for example, Orange 8.03). This matches the
    design.md table.
- **Theme toggle re-derives the token.** `ThemeProvider.tsx:118-121` calls `applyAccentTokens(accentColor, theme)` on
  `[accentColor, theme]`, so the per-theme 22/24% value stays current.
- **Consumer audit.** All 40 `--app-accent-strong` hits in frontend CSS are `background:` declarations or comments. No
  `color:` or `border` use would be weakened by a lighter tint. The only TS consumer is the chart emphasis path
  (`chartAppearance.ts`, `useChartOption.ts`, and the `timeAxisTestSupport.ts` fixture), and D2b covers it.
  `accentTextClosureGuard.css.test.ts` mentions the token only in a comment.
- **Light primary-hover state visibility** (my own computation): the hover clears 1.10 against both rest and backdrop for
  every preset.
  - Hover vs rest: lowest is Yellow at 1.163.
  - Hover vs `#f4f2ed`: lowest is 1.474.
- **D2 selectors and specificity** (verified against `PipelineMobile.css:393-431`):
  - `:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary)` is (0,4,0).
  - Its `:hover:not(:disabled)` form is (0,6,0). It beats the base hover at (0,3,0).
  - Neither selector matches the Run pill (`MobilePipelineActions.tsx:61` carries `mobile-pill--primary`). That leaves
    `.mobile-pill--primary` at (0,1,0) and its (0,3,0) hover in effect.
  - `.mobile-pill:disabled` sets only opacity, so there is no conflict.
- **D2 ratios recomputed from the `theme.css:254-258` / `343-347` values:**

  | Pair | Ratio |
  | --- | --- |
  | Light: `#fff` vs `#efece6` | 1.179 |
  | Light: `#fff` vs `#f4f2ed` | 1.119 |
  | Light: current `#fdfcfa` vs `#fff` | 1.025 (the red-first value) |
  | Dark: hover vs rest | 1.133 |
  | Dark: hover vs backdrop | 1.234 |

  All match design.md.
- **Exception to remove exists:** `e2e/hel1582-mobile-pipeline.spec.ts:1089-1112` (`isKnownAccentHover`,
  `KNOWN_ACCENT_HOVER_FLOOR = 3.9`).
- **DESIGN.md cited lines exist:** `DESIGN.md:131`, `:489`, `:922` (the stale `color-mix` recipe) and `:1734`.
- **Prior REFUTE items closed:**
  - skeptic-design-2 R1: exact selectors, specificity lines, and the rendered Run-pill rest==accent check shown red
    against the naive rule are all in D2 and tasks 2.1 / 3.2.
  - skeptic-design-2 R2: the loop is removed, the dense sweep guard is specified, the `#767676` loop claim is gone, and the
    mutation is retained.
  - Non-blocking notes: the defaults are added and the surface-soft caveat is recorded for the PR body.
- **AC coverage:**
  - AC1 (4.5:1 in both themes): D1, D3, task 1.3, the spec delta, and the running-app scenario.
  - AC2 (Dry run 1.10 vs rest): D2 and tasks 2.1 / 3.2.
  - AC3 (running app on desktop and phone, light and dark, exception removed): D4, tasks 4.2 and 3.1.
  - No scope drift, no placeholders, no contradictions between the proposal, design, tasks and specs.

### Verdict: CONFIRM

### Non-blocking notes
- Across the full cube, the true minimums are 4.83 (dark) and 4.93 (light), at `#f50000`. The artifact's 4.86 / 4.96 are
  the step-3 grid minimums. If the guard states a floor, it should quote the step it actually uses.
- The "hover >= rest" assertion must be non-strict (`>=`). No-op mixes (`#ffffff`, `#000000`) give exact equality.
- With the exception gone, task 3.1 should also drop the now-redundant `knownPair` / `otherPillText` bookkeeping at
  `hel1582-mobile-pipeline.spec.ts:1105-1112`, not leave half of it behind.
- Light primary hover becomes a lighter tint. Yellow's hover is only 1.649:1 against a white surface. That is not a WCAG
  floor, but it belongs in the PR body's "UI decisions taken overnight" entry next to the tint-direction change.

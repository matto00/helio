## Context

`--app-accent` and `--app-accent-ink` are written inline on `<html>` at runtime by `applyAccentTokens`
(`frontend/src/theme/appearance.ts`), keyed on the user's accent (8 presets + a free `type="color"` custom accent).
The ink is the better of `#181511` / `#fdfcfa` against the accent; for all 8 presets that is the dark ink.
`--app-accent-strong` is NOT written at runtime: it is the static `theme.css` declaration
`color-mix(in srgb, var(--app-accent) 78%, white)` (dark block) / `76%, black` (light block), resolved against the
inline `--app-accent`. In light it darkens the accent toward the dark ink, so contrast falls:

| preset | rest (ink on accent) | light hover today (24% black) | dark hover today (22% white) |
| --- | --- | --- | --- |
| Orange #f97316 | 6.49 | 3.93 | 8.03 |
| Red #ef4444 | 4.83 | 3.06 | 6.25 |
| Pink #ec4899 | 5.16 | 3.22 | 6.62 |
| Purple #a855f7 | 4.60 | 2.95 | 6.29 |
| Blue #3b82f6 | 4.95 | 3.13 | 6.77 |
| Cyan #06b6d4 | 7.49 | 4.47 | 8.94 |
| Green #22c55e | 7.98 | 4.76 | 9.45 |
| Yellow #eab308 | 9.49 | 5.56 | 10.95 |

(Computed with the WCAG formula from sRGB hex, 8-bit rounded mix; the browser's `color-mix` may differ by ~0.02 —
ticket's 3.95 for Orange.) The static `theme.css` fallbacks are self-consistent (dark block: dark ink, mix to white;
light block: white ink `#ffffff`, mix to black) — only the runtime combination is wrong.

`--app-accent-strong` consumers: ~35 primary-button `:hover` backgrounds across features, plus
`chartAppearance.ts` (`accentStrong`, HEL-566 series hover emphasis). `focusRingTokenGuard.css.test.ts` parses the
theme.css `--app-accent-strong` declaration (HEL-1050 D5a: proves strong is not a conforming focus colour).

## Goals / Non-Goals

**Goals:** ink on `--app-accent-strong` >= 4.5:1 for every preset in both themes, app-wide, by fixing the token (one
place), not per component; light Dry run pill hover >= 1.10:1 vs its rest fill; remove HEL-1582's exception pin.

**Non-Goals:** a new state-token pair (`--app-state-hover`; DESIGN.md says that needs owner sign-off); changing
`--app-accent-ink` selection or rest contrast; changing the desktop spine header's Dry run (already on the `--app-bg`
rung, `--app-surface-raised`) unless measurement shows it fails; per-component overrides of the accent hover.

## Decisions

### D1 — Derive `--app-accent-strong` at runtime, away from the ink
`buildAccentTokens` additionally returns `--app-accent-strong` as a hex: the accent mixed toward white when the
chosen ink is the dark ink, toward black when it is the light ink, at a FIXED amount per theme (dark theme 22%, light
theme 24% — so the dark theme is the same colour as today's `color-mix` for every shipped preset, modulo rounding).
No step-up loop (skeptic design-2 R2): a sweep of the sRGB cube (every 3rd value per channel) shows the weakest ink
contrast at these amounts is 4.96 (light) / 4.86 (dark), both at `#f60000`, so a loop would be unreachable code with an
unwritable test. Mixing away from the ink is monotonic in contrast, so hover contrast >= rest contrast always holds.

Rationale: the direction depends on the ink, which is a runtime value; CSS alone cannot express "away from the ink"
without a new helper token. Writing one more inline property follows the existing pattern (`--app-focus-ring-color`,
`--app-accent-text`, `--app-selection-bg` are all JS-derived per accent+theme). No new token name; every consumer keeps
reading `--app-accent-strong`. Fully reversible (one function).

Alternatives rejected: (a) flip the light `theme.css` mix to `white` — fixes every shipped preset but would erode
contrast for a custom dark accent with a light ink, and breaks the static fallback's self-consistency; (b) per-component
hover overrides — forbidden by the ticket and DESIGN.md; (c) new `--app-accent-hover-mix` helper token — adds a name
other code would depend on.

**Overnight UI decision (reversible):** in the light theme the primary hover becomes a lighter tint of the accent
rather than a darker shade, and chart hover emphasis (`accentStrong`) follows. Record in the PR body.

`theme.css` static fallbacks stay as-is, with the comment updated to say `--app-accent-strong` is now also
runtime-written (dead after first effect, like `--app-accent`). `focusRingTokenGuard.css.test.ts`'s HEL-1050 D5a block
(lines ~839-905) is retargeted to assert against `buildAccentTokens(hex, theme)["--app-accent-strong"]` for every preset
in both themes (the value that actually renders), not the static fallback (skeptic design-1 R3).

### D2 — Dry run pill: light rest moves to `--app-surface-soft`, hover stays `--app-surface-strong` (revised, skeptic design-1 R1)
The pill floats over the page canvas: HEL-1582's rendered evidence
(`.concertino/runs/HEL-1582/evidence/e2e-evidence/HEL-1582/phone-state-contrast.json`) measures its backdrop as
`--app-bg`. DESIGN.md §3's hover rung for an `--app-bg` backdrop is `--app-surface-raised`/white, which is what ships
(`--app-surface-strong` = `#fff` in light). The defect is the REST fill: `--app-surface` (`#fdfcfa`) is nearly white,
so the hover is only 1.025:1 from it. No existing neutral hover token clears 1.10 against both the backdrop and the rest
fill in light (e.g. `--app-surface-soft` hover = 1.054 vs `#f4f2ed`, failing the backdrop floor the test keeps).

Decision (existing tokens only, light theme only), exact selectors (skeptic design-2 R1 — a naive
`:root[data-theme="light"] .mobile-pill` at (0,3,0) would outrank `.mobile-pill--primary` (0,1,0) and turn the Run pill's
rest fill neutral):

```css
:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary) {            /* (0,4,0) */
  background: var(--app-surface-soft);
}
:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary):hover:not(:disabled) {  /* (0,6,0) */
  background: var(--app-surface-strong);
}
```

The primary pill's rules are untouched and never matched by either selector. Dark unchanged.

| theme | rest | hover | hover vs rest | hover vs backdrop (`--app-bg`) |
| --- | --- | --- | --- | --- |
| light | `#efece6` | `#ffffff` | 1.179 | 1.119 (`#f4f2ed`) |
| dark | `#1a1816` | `#262320` | 1.133 | 1.234 (`#0f0e0d`) |

The rest pill keeps its `--app-border-strong` hairline and `--app-shadow-soft`, so it stays delineated from the canvas.
A rendered e2e assertion, both themes, checks the Run pill's resting background equals the resolved `--app-accent`
(and its hover equals `--app-accent-strong`), shown failing first against the naive `:root[data-theme="light"]
.mobile-pill` rule. **Overnight UI decision (reversible, two CSS rules):** the light Dry run pill rests on
`--app-surface-soft` — DESIGN.md's "recessed" level, an imperfect semantic fit for a floating pill — instead of
near-white; record that caveat in the PR body. If
measurement shows this fails any existing floor, escalate rather than inventing a new state token.

### D2b — Chart hover emphasis decoupled from the button-hover token (skeptic design-1 R2)
`applyHoverEmphasis` (`chartAppearance.ts`) uses `accentStrong` as a non-text indicator (2-3px line/border) on panel
surfaces. Today `getComputedStyle` returns an unresolved `color-mix()` string for it; once D1 writes a hex, a lighter
tint would paint in light theme and fall below 3:1 on white panels (Yellow ~1.65, Green ~1.90). Decision: the chart
emphasis reads `--app-focus-ring-color` instead (already JS-derived per accent, theme-independent, guaranteed >= 3:1
against the ten theme surfaces in `FOCUS_RING_SURFACES`). Rename the token field accordingly (e.g. `accentEmphasis`),
update the SSR/Jest fallback and the comments. Executor measures before/after emphasis colour in the running app
(light and dark, one chart) and records it. **Overnight UI decision (reversible):** chart hover emphasis uses the
focus-ring accent shade.

### D3 — Tests
- Unit (`appearance.test.ts` or a new guard): all 8 presets x 2 themes, ink on derived strong >= 4.5; hover >= rest
  contrast AND ink on strong >= 4.5 for a dense sRGB sweep (every 3rd value per channel, or at least every 15th if
  runtime demands — state the step) including custom accents that pick the light ink; the two default accents
  `#f97316` / `#ea580c` explicitly; dark-theme presets unchanged vs the old
  22%-white mix within 1 per channel. Mutation: reverting the derivation to "toward black in light" must fail the guard
  (show it red, transcript recorded).
- Red-first (skeptic design-1 R5): the new Dry run hover-vs-rest >= 1.10 assertion is run against the CURRENT CSS and
  shown failing (1.025) before the CSS fix; the Run pill 4.5 check with the exception removed is shown failing against
  the old "toward black" token before the token fix; the Run pill rest == `--app-accent` check is shown failing
  against the naive light `.mobile-pill` rule. Record all three red transcripts.
- e2e `hel1582-mobile-pipeline.spec.ts`: delete `isKnownAccentHover` / `KNOWN_ACCENT_HOVER_FLOOR` and its pin
  assertions; the Run pill hover is then held to 4.5 by the generic filter. Add the Dry run hover-vs-rest >= 1.10
  assertion in both themes.
- Grep every e2e/unit test asserting a primary hover colour or `accentStrong` value (ChartPanel.theme.test.tsx,
  chartAppearance.test.ts, focusRingTokenGuard, hel1579 accent audit) and update only what the change legitimately
  moves.

### D4 — Running-app evidence
Screenshots of primary-button hover, before (main) and after, light and dark, desktop (1440) and phone (390): spine
header Run pipeline, phone Run pill and Dry run pill, a Modal primary, a settings primary, auth primary, plus rendered
contrast numbers. Saved under `/home/matt/Development/helio/.concertino/scratch/HEL-1669/`.

## Risks / Trade-offs

- Sibling lanes HEL-1620 / HEL-1608 edit `e2e/hel1579-pipeline-spine-layout.spec.ts` and spine CSS; this change does not
  plan to edit either, but the hel1579 accent audit renders the Run hover — verify it still passes.
- Pre-hydration flash: the static fallback differs from the runtime value (already true for ink); unchanged in kind.
- DESIGN.md §3 token table / §5 Primary recipe gets a one-line note that `--app-accent-strong` is ink-aware; the stale
  `color-mix` recipe text in DESIGN.md §8 (~line 922) and A.7 (~line 1734), and the comments in `chartAppearance.ts:33-58`
  and `useChartOption.ts:88-90`, are updated (skeptic design-1 R4).

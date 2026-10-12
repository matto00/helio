## Context

See proposal.md (Why). Current state on main (9e51550f1):

- `PanelCard.getPanelCardStyle(appearance, theme)` (also used by `MobilePanelStack`) is the single place a custom
  panel background reaches the DOM: inline `--panel-surface-override` (`buildPanelSurface`, theme surface tinted 0.24
  toward the chosen colour, alpha from transparency) and `--panel-text-override` (`resolvePanelTextColor`, which
  already keeps the preferred text if it clears 4.5:1 on the 0.24-tinted surface, else picks the better of two
  readable literals). `theme/appearance.ts` already has `parseHexColor`, `blendColors`, `resolveTintedSurface`,
  relative-luminance `getContrastRatio`, and a `themeAppearancePalette` mirroring `--app-surface`/`--app-text` per
  theme (lockstep comment).
- Tone text: `.panel-content__metric-figure--tone-*` (metric, and collection via `MetricRenderer`),
  `td.ui-data-grid__cell--tone-*` (text on the `-surface` wash) and `.ui-data-grid__tone-mark--*` all read
  `var(--app-<tone>)`. Washes are `color-mix(var(--app-<tone>) 11/10% light, 14% dark, transparent)` declared on
  `:root`, so they are computed there and inherited as resolved values.
- Delta: `.panel-content__metric-trend--up/down` read `--app-success`/`--app-error`, `--flat` reads
  `--app-text-muted` (PanelContent.css ~266-286; used by the legacy `trend` string and `ComparisonLine`).
- Unit/label: `color-mix(in srgb, currentColor var(--panel-secondary-text-mix), transparent)`, token 62% light /
  60% dark on `:root`.
- Prototype numbers (token-computed, 0.24 tint, opaque): light theme on `#ff0000` tone text 4.05-4.08 on surface,
  3.54-3.57 on the wash; light on `#000000` 3.47-3.49; dark on `#ffffff` error 3.01. Unit/label light on `#3366ff`
  4.15, on `#000000` 3.71; dark on `#ffcc00` 4.19. Default surfaces pass (HEL-533 / #962 tuning).
- No tone or delta colour reaches ECharts (tones are DOM text only; `MetricSparkline` is an SVG polyline). Charts are
  untouched.

## Goals / Non-Goals

**Goals:** ticket.md ACs 1-8. **Non-Goals:** editor warnings; other muted panel text (metric note, footers,
`--app-text-muted` elsewhere); chart series colours; transparency-aware compositing (see Risks).

## Decisions

**D1 - Compute at render time in TS, not in CSS.** CSS cannot compare luminance (no `contrast-color()` with a
threshold in our browser targets). The resolved surface is already computed in TS from the same inputs
(`resolveTintedSurface(palette.panelSurface, background, 0.24)`), so the picker runs there, once per panel style
(already memoized per `appearance`/`theme` in `PanelCard`). Alternative: measure computed styles in the DOM with an
effect - rejected (layout reads per panel, flash of failing colour, untestable in jsdom).

**D2 - The picker: `pickReadableColor(preferred, backdrops, minRatio = 4.5): string` (hex in, hex out).** Pure, exported
from `theme/appearance.ts`, reusing `getContrastRatio`. If `preferred` clears `minRatio` on EVERY backdrop, return it
unchanged. Otherwise pick the direction: black if `getContrastRatio(black, worstBackdrop) >=
getContrastRatio(white, worstBackdrop)`, else white (worst = lowest-contrast backdrop for `preferred`). Step
`blendColors(preferred, extreme, t)` for t = 0.04, 0.08, ... 1.0 and return the first step that clears `minRatio` on
every backdrop (hex). Why: a darker/lighter step of the SAME colour keeps the hue recognisable (mixing toward black/
white in sRGB holds hue, lowers chroma only as far as needed); the smallest passing step changes as little as
possible. If no step passes (only possible when backdrops straddle the black/white crossover), return whichever
extreme scores the higher worst-case ratio. Alternatives: (a) fall back to the panel text colour - rejected as the
first choice, it drops the tone hue entirely (glyph/sr text still carry meaning, but the ruling asks for a readable
variant of the tone); (b) HSL lightness search - equivalent result, more code. Output is `#rrggbb`, so it is
ECharts-safe if ever reused there (no `color-mix()`).
**Margin rule (design gate 1):** backdrops (washes, and the D5 unit/label composite) are computed UNROUNDED (float
channels, no 8-bit rounding before luminance), matching what the browser composites, and the picker and the D5 mix
search use an internal target of 4.55 while the contract stays 4.5. Rationale: an 8-bit-rounded model certified
4.502 where the browser renders 4.487 (dark, `#00ffff`, success); the 0.05 margin also absorbs one-step rounding of
the final hex. Pinned by a near-threshold unit test (that pair, or an equivalent one found by the executor).

**D3 - Backdrops per colour.** Tone text: the opaque tinted surface AND ALL THREE tone washes over it
(`surface` blended toward each tone token by its wash share, 0.11/0.11/0.10 light, 0.14 dark, mirroring theme.css).
All three, not only the tone's own wash, because a row rule's tone mark lands in the row's first data cell
(`tableConditionalFormats.tsx` ~46-74), which may carry a DIFFERENT tone's cell wash (design gate 1: e.g. dark on
`#3366ff`, error mark on the warning wash 4.17 if only its own wash were scored). One variant per tone then serves the
metric figure (surface), the cell text (own wash) and the mark (any wash). Delta up/down/flat: the surface only. Variants
replace TEXT only; the washes stay on the original token (they are computed on `:root`, so overriding a tone on the
card cannot move them, which is what we want: the wash keeps its hue).

**D4 - Per-panel inline custom properties, emitted only when needed.** `getPanelCardStyle` adds, only when
`appearance.background !== "transparent"` AND the picked value differs from the token: `--panel-tone-success`,
`--panel-tone-warning`, `--panel-tone-error`, `--panel-tone-muted` (delta flat). CSS consumers become
`var(--panel-tone-<x>, var(--app-<x>))`. A default panel emits nothing, so it renders byte-identically (AC5). The
computation lives in one helper (e.g. `resolvePanelReadableTones(theme, appearance)`) so `getPanelCardStyle` stays a
thin mapper. Alternative: always emit - rejected (AC5 and the live-token guarantee on default panels).

**D5 - Unit/label: raise the per-panel mix, stay currentColor-relative.** The rendered colour is
`blend(surface, panelText, p)` where `panelText` = `resolvePanelTextColor(...)`. Find the smallest whole percent
`p >= theme default (62 light / 60 dark)` that clears 4.5:1 on the surface; emit `--panel-secondary-text-mix: p%`
inline only when `p` exceeds the default. Keeps following custom panel text (HEL-1307 spec) and only narrows the
value/unit hierarchy as much as needed. 100% renders `currentColor` exactly, which `resolvePanelTextColor` already guarantees at 4.5:1; if no whole
percent reaches the 4.55 internal target (a custom text colour measuring 4.50-4.55), the mix caps at 100% (test pins
it).
Defaults (62/60) are mirrored in TS next to `themeAppearancePalette`.

**D6 - Token mirrors are guarded.** The tone hexes, wash shares, `--app-text-muted` and the mix defaults are copied into
`appearance.ts` (CSS vars are unreadable in this pure path, same precedent as `themeAppearancePalette`). A guard test
parses `theme.css` and fails if any mirror drifts; proven failable by mutation (C1 style), not red-first.

**D7 - Scope of consumers.** Switch exactly: `.panel-content__metric-figure--tone-*`, `td.ui-data-grid__cell--tone-*`
(color only), `.ui-data-grid__tone-mark--*`, `.panel-content__metric-trend--up/down/flat`. Fullscreen overlay: a native
`<dialog>` rendered inside the card, so it inherits the inline variables (harmless: variants only raise contrast).
Public dashboard viewer: never applies `getPanelCardStyle`, so it shows the default surface where the tokens pass; it
is unchanged by this ticket (design gate 1 settled both).

## Risks / Trade-offs

- [Panel transparency > 0 lets the dashboard show through, so the real backdrop differs from the opaque tinted
  surface] -> same approximation `resolvePanelTextColor` already makes; stated, not solved; follow-up if measured fail.
- [A strongly stepped tone looks close to the text colour] -> glyph + sr label carry meaning (spec unchanged);
  smallest passing step.
- [Mirror drift between theme.css and appearance.ts] -> D6 guard.
- [Ordinary (non-tone) text in a row-washed cell is only checked against the surface] -> pre-existing, out of
  scope; listed as a follow-up.
- [Concurrent HEL-1487 touches chart label colours] -> no overlap: no ECharts colour changes here.

## Migration Plan

Frontend only, no data change. Rollback is a revert.

## Planner Notes

- Self-approved: hex-stepping toward black/white (D2), inline-vars-only-when-needed (D4), flat delta included (D3/D7).
- Owner ruling (runtime fallback, no editor warning) is recorded on HEL-1490; not re-escalated.

## Gate-Chain Implications Checklist

The diff touches `scripts/check-tokens.mjs` (run by `.husky/pre-commit` as `npm run check:tokens`). The change is data
only: four entries added to the exported `ALLOWLIST` object for the runtime-set `--panel-tone-*` tokens. No logic,
I/O, imports or invocation changed.

- **What does it execute?** Unchanged: `node scripts/check-tokens.mjs`, which reads CSS files under `frontend/src`
  and checks every `var(--*)` reference resolves to a declaration or an allowlist entry. The new entries only add four
  names to the allowlist lookup.
- **What environment does it inherit, and from where?** Unchanged: the git hook's environment via husky/npm (cwd at
  the repo or worktree root, the hook's `GIT_*` variables). The script reads no environment variables and runs no git.
- **Does it write anything outside its own sandbox?** No. It only reads CSS files and prints to stdout/stderr; it
  writes no files, and this change adds no writes.
- **Does it behave differently from a linked worktree than from a main checkout?** No. It resolves its scan root
  relative to its own file (`frontend/src`), never via `.git`, so a linked worktree and the main checkout scan their own
  trees identically.
- **What happens on its first run?** The same as every run: a read-only scan that passes (the four tokens are now
  allowlisted) or fails with the unresolved names. No state, cache or setup step exists.

## Standing Constraints

- [C1] Owner ruling (HEL-1490 comment): runtime auto-adjust to a readable variant on custom panel backgrounds; no editor warning; do not re-escalate.

## 1. Frontend - picker and per-panel variants

- [x] 1.1 Red first: write `pickReadableColor` unit tests with known pairs (pass-through, step darker on light, step lighter on dark, multi-backdrop worst case, hex output, near-threshold rounding pair cleared with the 4.55 internal target against unrounded backdrops); run and record the failure
- [x] 1.2 Implement `pickReadableColor` in `theme/appearance.ts` reusing `getContrastRatio`/`blendColors`; 1.1 goes green
- [x] 1.3 Mirror tone hexes, wash shares, `--app-text-muted` and mix defaults per theme; guard test parsing `theme.css`, proven by mutation
- [x] 1.4 Red first: tests for the per-panel resolver (transparent emits nothing; `#ff0000` light emits passing tone vars; `#3366ff` light raises the mix; token kept when passing; a row-rule mark tone on a different tone's wash passes, e.g. dark `#3366ff` error on warning wash)
- [x] 1.5 Implement the resolver and wire it into `PanelCard.getPanelCardStyle`; 1.4 goes green
- [x] 1.6 Switch the D7 CSS consumers to `var(--panel-tone-<x>, var(--app-<x>))`; CSS test pins the fallback form

## 2. Tests and verification

- [x] 2.1 `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check` green with no new `eslint-disable`
- [x] 2.2 (evaluator) Running app: light, dark and saturated custom backgrounds, both themes, 1440 and 375; computed-style contrast table for tone text (surface + own wash), tone mark on a different tone's cell wash, delta, unit, label
- [x] 2.3 Default panel regression: computed colours equal the theme tokens, no inline `--panel-tone-*`

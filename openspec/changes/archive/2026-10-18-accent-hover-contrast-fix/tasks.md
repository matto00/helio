## Standing Constraints

## 1. Accent hover token (D1)
- [x] 1.1 Add an ink-aware `--app-accent-strong` derivation to `buildAccentTokens` in `frontend/src/theme/appearance.ts` (away from ink; fixed 22% dark / 24% light; no step-up loop — design D1)
- [x] 1.2 Update the `theme.css` fallback comments (both theme blocks) to note `--app-accent-strong` is runtime-written; keep declarations parseable
- [x] 1.3 Unit guard: 8 presets + defaults #f97316/#ea580c x 2 themes >= 4.5; dense sRGB sweep, step stated in the test (ink on strong >= 4.5 and >= rest, equality allowed for pure white/black) incl. light-ink accents; dark presets unchanged vs old mix; show the guard red against the old "toward black" behaviour
- [x] 1.4 Retarget focusRingTokenGuard's HEL-1050 D5a block to `buildAccentTokens(...)["--app-accent-strong"]` (all presets, both themes); reconcile accentTextSourceSyncGuard and any other test reading the token — update only what the change legitimately moves
- [x] 1.5 Chart hover emphasis (D2b): `applyHoverEmphasis` reads `--app-focus-ring-color` instead of `--app-accent-strong`; rename the field, update fallback/comments, chartAppearance.test.ts and ChartPanel.theme.test.tsx; measure before/after emphasis colour in the running app

## 2. Dry run hover (D2)
- [x] 2.1 Add exactly D2's two selectors (`:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary)` rest `--app-surface-soft`, and its `:hover:not(:disabled)` `--app-surface-strong`); dark unchanged

## 3. e2e (D3)
- [x] 3.1 Remove HEL-1582's `isKnownAccentHover` / `KNOWN_ACCENT_HOVER_FLOOR` exception and pin assertions from `e2e/hel1582-mobile-pipeline.spec.ts`, including the leftover `knownPair` / `otherPillText` checks (~:1105-1112)
- [x] 3.2 Add Dry run hover-vs-rest >= 1.10 assertion, both themes; plus Run pill rest background == resolved `--app-accent` (and hover == `--app-accent-strong`) in both themes; show each RED first (Dry run vs current CSS, Run pill 4.5 vs old token, Run pill rest vs the naive light `.mobile-pill` rule) and record the transcripts
- [x] 3.3 Run hel1582, hel1579 and state-surface-contrast-guard specs (2 workers, nice -n 19, under the e2e lock)

## 4. Docs and evidence (D4)
- [x] 4.0 PR body "UI decisions taken overnight": lighter light-theme primary hover (note Yellow hover is 1.649:1 vs white), chart emphasis on --app-focus-ring-color, light Dry run rest on --app-surface-soft (recessed-level caveat)
- [x] 4.1 DESIGN.md: note that `--app-accent-strong` is ink-aware (§3 token table / §5 Primary recipe); fix stale color-mix recipe text in §8 (~922) and A.7 (~1734); update comments in chartAppearance.ts:33-58 and useChartOption.ts:88-90
- [x] 4.2 Running-app before/after screenshots + rendered contrast numbers, light/dark x desktop/phone, in `/home/matt/Development/helio/.concertino/scratch/HEL-1669/`

## Why

`--app-accent-ink` on `--app-accent-strong` is the hover state of every primary button in the app (~35 call sites:
Run pipeline, modal primaries, settings, auth, onboarding, chart hover emphasis). In the light theme it measures
3.93:1 for the default Orange accent and as low as 2.95:1 (Purple) for other shipped presets, below the 4.5:1 text
floor. Root cause: the ink is chosen per accent at runtime (`buildAccentTokens`, dark ink `#181511` for every shipped
preset), but `--app-accent-strong` is a static `theme.css` `color-mix` toward **black** in light, i.e. toward the ink,
which erodes contrast. HEL-1582 pinned the pair at >= 3.9:1 as a named exception. Separately, the phone Dry run pill's
light hover (`--app-surface` -> `--app-surface-strong`) differs from its rest fill by only 1.025:1.

## What Changes

- `--app-accent-strong` becomes ink-aware: `buildAccentTokens` derives it at runtime by mixing the accent **away from
  the chosen ink** (toward white for a dark ink, toward black for a light ink) and writes it inline alongside
  `--app-accent`/`--app-accent-ink`, raising the mix until the ink clears 4.5:1 where achievable. The `theme.css` static
  fallbacks are already consistent with their own static inks and stay as the pre-hydration fallback.
- Visible effect: in the light theme, primary-button hover for every shipped preset becomes a lighter tint of the
  accent instead of a darker shade. Dark theme hover for shipped presets is unchanged.
- Chart hover emphasis (a non-text indicator) stops reading the button-hover token and reads `--app-focus-ring-color`
  (already guaranteed >= 3:1 against theme surfaces).
- The phone Dry run pill (on the `--app-bg` canvas) rests on `--app-surface-soft` in light instead of near-white
  `--app-surface`, keeping its `--app-surface-strong` hover: 1.179:1 hover vs rest, 1.119:1 vs backdrop. Dark unchanged.
- HEL-1582's named exception (`KNOWN_ACCENT_HOVER_FLOOR = 3.9`) is removed from `e2e/hel1582-mobile-pipeline.spec.ts`;
  the Run pipeline pill hover is held to 4.5:1 like everything else.
- Unit guard: every shipped preset x both themes asserts ink on derived strong >= 4.5:1.

## Capabilities

### New Capabilities

### Modified Capabilities
- `accessible-token-contrast`: adds a requirement that the accent ink clears 4.5:1 on the accent hover fill for every preset in both themes.
- `pipeline-detail-mobile-layout`: removes the named 3.9:1 exception from "Phone touch floor and state contrast" and requires the Dry run hover to differ from its rest fill by at least 1.10:1.

## Impact

- `frontend/src/theme/appearance.ts` (`buildAccentTokens`, new derive helper), its unit tests, possibly
  `focusRingTokenGuard.css.test.ts` / `accentTextSourceSyncGuard.css.test.ts` if they assume `--app-accent-strong` is
  CSS-only.
- `frontend/src/features/pipelines/ui/mobile/PipelineMobile.css` (Dry run hover rung).
- `e2e/hel1582-mobile-pipeline.spec.ts` (exception removed).
- Any e2e that asserts primary-hover colour (to be grep-checked; hel1579 accent audit in particular, which sibling
  lanes HEL-1620/HEL-1608 are also editing).
- `DESIGN.md` §3/§5 note on `--app-accent-strong` derivation.

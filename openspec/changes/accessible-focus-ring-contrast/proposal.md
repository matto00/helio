## Why

`--app-focus-ring` resolves to the raw brand accent, so every `:focus-visible` element in the app renders a
focus indicator at 2.38–2.80 against the 3:1 non-text floor in the shipped default light theme. The whole
keyboard-navigation affordance is below an accessibility floor in the theme most users see. HEL-1022's
centralisation made it universal and also makes it fixable in one place.

## What Changes

- Add a dedicated `--app-focus-ring-color`, **derived** as the minimum adjustment to the active accent that
  clears 3:1 against the worst surface in **both** themes, and point `--app-focus-ring` at it.
- Leave `--app-accent` untouched, so brand appearance everywhere else is unchanged.
- Correct `theme.css`'s dead per-theme `--app-accent`/`--app-accent-ink` defaults and the comment that
  misdescribes them.
- Add a guard computing the ring's contrast across every surface × both themes × all 8 presets.

## Capabilities

### New Capabilities

- `accessible-focus-indicator`: the keyboard focus indicator meets the non-text contrast floor against every
  surface it can appear on, in both themes and for every accent choice.

### Modified Capabilities

- `theme-token-contract`: the accent tokens a theme declares must be the ones that actually render, so the
  stylesheet cannot state a per-theme value that runtime application silently overrides.

## Impact

- `frontend/src/theme/theme.css` — new token, `--app-focus-ring` re-pointed, dead defaults corrected.
- `frontend/src/theme/appearance.ts` — `buildAccentTokens` emits the derived ring colour. **Signature
  unchanged**: the value is theme-independent by construction, so no theme argument is needed.
- A new contrast guard, and a `DESIGN.md` §8 entry recording the derivation.
- No backend, wire or schema impact — but `theme.css` is the most shared file in the frontend, so "no wire
  impact" is emphatically not "no downstream impact".

## Non-goals

- **Accent-as-text (4.5:1) — HEL-1048**, including the empty-state "Create one" link. Provably cannot be
  fixed theme-independently (the 4.5:1 luminance window is empty), so it needs a theme-aware derivation that
  changes rendered brand colour app-wide — an owner-level identity call that must not ride in on this
  ticket's accessibility evidence, even though both are now in v0.7.
- Retuning the eight brand preset hexes. HEL-1047, HEL-866, HEL-1044, HEL-520, HEL-533 — not absorbed.

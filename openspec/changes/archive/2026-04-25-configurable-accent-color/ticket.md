# HEL-69 — Add configurable workspace accent color with orange default

## Context

As part of the HEL-62 visual redesign, the app adopts a single CSS token (`--app-accent`) that drives all accent surfaces: the dot-grid overlay, active nav indicators, sidebar active state, panel hover borders, chart bar gradients, buttons, and badges. Because everything flows from one token, exposing it as a user-configurable setting is low-cost and high-value — it lets users personalize their workspace without touching anything else.

The default accent color established by HEL-62 is orange (`#f97316`).

## What changes

* Add a color picker (or curated palette of preset colors) to a workspace settings panel or settings page
* Persist the selected accent color (localStorage or backend user preferences)
* Apply the selection by updating `--app-accent` (and its derived `--app-accent-dim`, `--app-accent-mid` rgba variants) on the `:root` element at runtime
* The default value is `#f97316` (orange)

## Out of scope

* Per-dashboard accent colors (dashboard appearance already has its own editor)
* Custom color input beyond a picker or preset swatches

## Acceptance criteria

- [ ] A settings entry point exists in the UI (e.g. settings page, sidebar footer popover, or command bar menu)
- [ ] User can select an accent color from a picker or curated set of presets
- [ ] Selecting a color immediately updates the accent across the full app (dot grid, nav active state, buttons, badges, chart bars)
- [ ] The selected color persists across page reloads
- [ ] Default accent color is `#f97316` (orange) when no preference has been saved

## Related

- HEL-62: Helio visual redesign (establishes `--app-accent` token)
- https://linear.app/helioapp/issue/HEL-62/helio-visual-redesign

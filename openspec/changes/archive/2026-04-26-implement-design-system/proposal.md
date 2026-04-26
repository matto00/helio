## Why

The Helio design system has been defined via the Claude Design handoff bundle but not yet applied to the codebase. DM Sans (the current font) and the placeholder dot-logo do not reflect the approved brand direction — Space Grotesk, JetBrains Mono, the Orbit mark, and the full token set from `colors_and_type.css` need to land in the frontend now so all subsequent UI work builds on the correct foundation.

## What Changes

- Replace DM Sans Google Fonts import with Space Grotesk + JetBrains Mono in `index.html`
- Update `theme.css` font-family stacks to use Space Grotesk (sans) and JetBrains Mono (mono)
- Land the full token set from `colors_and_type.css` into `theme.css`: type scale (`--text-micro` → `--text-3xl`), semantic roles (`--h1-size`, `--eyebrow-*`), spacing scale (`--space-1` → `--space-10`), brand orange (`--app-accent`), `--app-radius-pill`
- Replace the dot SVG in the command bar logo with the Orbit SVG mark (circle ring + quarter-arc + center dot, glowing in `var(--app-accent)`)
- Update wordmark letter-spacing from 0.18em → 0.14em
- Add `.eyebrow`, `.wordmark`, `.mono` utility classes to `theme.css` and apply where appropriate
- Apply `var(--font-mono)` + `font-variant-numeric: tabular-nums` to metric/stat values in panels
- Add Orbit mark SVG assets to `public/` for favicon/OG use

## Non-goals

- Motion system implementation (stretch goal; deferred)
- Light theme token updates (only dark theme token values are specified in the handoff bundle at this time)
- Backend changes of any kind

## Capabilities

### New Capabilities
- `helio-design-tokens`: Full type scale, spacing scale, semantic role tokens, and brand variables from the design handoff landed in `theme.css`
- `orbit-logo-mark`: Orbit SVG logo mark replacing the dot placeholder in the command bar and added to `public/` for favicon/OG use

### Modified Capabilities
- `helio-visual-identity`: Typography system updated — Space Grotesk replaces DM Sans as the sans font; JetBrains Mono added for tabular/mono contexts; wordmark tracking updated to 0.14em
- `frontend-theme-system`: Token vocabulary expanded with the new design token set; `.eyebrow`, `.wordmark`, `.mono` utility classes added

## Impact

- `frontend/index.html` — Google Fonts link updated
- `frontend/src/theme/theme.css` — font stacks, full token set, utility classes
- `frontend/src/components/CommandBar/` (or equivalent logo location) — Orbit SVG mark swap, tracking update
- Panel components displaying metric/stat values — mono font applied
- `frontend/public/` — new Orbit SVG assets

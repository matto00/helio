## 1. Frontend — Fonts & Token Setup

- [x] 1.1 Fetch and decompress the design handoff bundle from `https://api.anthropic.com/v1/design/h/CHNxGF72tqOy6t_LC9p4ng` to extract token values from `helio-design-system/project/colors_and_type.css`
- [x] 1.2 Update `frontend/index.html` Google Fonts `<link>` to load Space Grotesk and JetBrains Mono (remove DM Sans)
- [x] 1.3 Update `:root` `font-family` in `frontend/src/theme/theme.css` to use Space Grotesk with system-ui/sans-serif fallbacks
- [x] 1.4 Add `--font-mono` CSS custom property to `:root` in `theme.css` with JetBrains Mono and monospace fallback

## 2. Frontend — Design Token Set

- [x] 2.1 Add type scale tokens (`--text-micro` through `--text-3xl`) to `:root` in `theme.css` using values from `colors_and_type.css`
- [x] 2.2 Add semantic role tokens (`--h1-size`, `--eyebrow-size`, `--eyebrow-tracking`, `--eyebrow-weight`) to `:root` in `theme.css`
- [x] 2.3 Add spacing scale tokens (`--space-1` through `--space-10`) to `:root` in `theme.css`
- [x] 2.4 Add `--app-radius-pill` to `:root` in `theme.css`

## 3. Frontend — Typography Utilities

- [x] 3.1 Add `.eyebrow` utility class to `theme.css` applying `font-size: var(--eyebrow-size)`, `letter-spacing: var(--eyebrow-tracking)`, `font-weight: var(--eyebrow-weight)`, `text-transform: uppercase`
- [x] 3.2 Add `.wordmark` utility class to `theme.css` applying `letter-spacing: 0.14em` and appropriate font-weight
- [x] 3.3 Add `.mono` utility class to `theme.css` applying `font-family: var(--font-mono)` and `font-variant-numeric: tabular-nums`

## 4. Frontend — Mono Font Application

- [x] 4.1 Update `frontend/src/components/TypeDetailPanel.css` — replace bare `font-family: monospace` with `font-family: var(--font-mono)`
- [x] 4.2 Update `frontend/src/components/ComputedFieldsEditor.css` — replace bare `font-family: monospace` with `font-family: var(--font-mono)`
- [x] 4.3 Update `frontend/src/components/AddSourceModal.css` — replace bare `font-family: monospace` with `font-family: var(--font-mono)`
- [x] 4.4 Identify panel components that render numeric metric/stat values and apply `font-family: var(--font-mono)` + `font-variant-numeric: tabular-nums` to those value elements

## 5. Frontend — Orbit Logo Mark

- [x] 5.1 Extract the Orbit SVG mark geometry from the design bundle (`helio-design-system/project/assets/logo-mark.svg`)
- [x] 5.2 Create `frontend/src/components/OrbitMark.tsx` — inline SVG component with circle ring, quarter-arc, and center dot; fill uses `var(--app-accent)`; `filter: drop-shadow(0 0 6px var(--app-accent))`
- [x] 5.3 Update `frontend/src/app/App.tsx` — replace `<span className="app-command-bar__logo-dot" aria-hidden="true" />` with `<OrbitMark />`
- [x] 5.4 Update `frontend/src/app/App.css` — remove `.app-command-bar__logo-dot` dot-circle styles; update `.app-command-bar__wordmark` letter-spacing to `0.14em`
- [x] 5.5 Update the sidebar logo in `App.tsx` / `App.css` — replace `.app-sidebar__logo-dot` dot element with `<OrbitMark />` and update `.app-sidebar__wordmark` letter-spacing to `0.14em`
- [x] 5.6 Add `orbit-mark.svg` (and a light-variant if needed) to `frontend/public/` for favicon/OG use

## 6. Tests

- [x] 6.1 Run `npm test` in the worktree and confirm all existing tests pass with the font/token/SVG changes
- [x] 6.2 Run `npm run lint` and `npm run format:check` and fix any issues

# HEL-126 — Implement Helio design system — Space Grotesk, orbit logo, design tokens

## Description

Apply the Helio design system from the Claude Design handoff bundle (`https://api.anthropic.com/v1/design/h/CHNxGF72tqOy6t_LC9p4ng`) across the frontend codebase for consistent branding.

## Design system source

Fetch and decompress: `https://api.anthropic.com/v1/design/h/CHNxGF72tqOy6t_LC9p4ng`

Key files in the bundle:

* `helio-design-system/project/colors_and_type.css` — full token set (source of truth)
* `helio-design-system/project/ui_kits/helio-web-app/` — React component references
* `helio-design-system/project/assets/logo-mark.svg` — Orbit logo SVG

## What "done" looks like (Acceptance Criteria)

* **Font**: DM Sans replaced with Space Grotesk (sans) + JetBrains Mono (mono) everywhere — `index.html` Google Fonts import, `theme.css` font stack, all inline font references
* **Design tokens**: Full token set from `colors_and_type.css` landed in `theme.css` — type scale (`--text-micro` → `--text-3xl`), semantic roles (`--h1-size`, `--eyebrow-*`, etc.), spacing scale (`--space-1` → `--space-10`), brand orange variables, `--app-radius-pill`
* **Logo**: Dot replaced with Orbit SVG (circle + arc quarter + dot, glowing) in command bar — tracking updated from 0.18em → 0.14em on wordmark
* **Typography utilities**: `.eyebrow`, `.wordmark`, `.mono` utility classes added to `theme.css` and applied where appropriate
* **Mono font applied**: Metric/stat values in panels use `var(--font-mono)` with `font-variant-numeric: tabular-nums`
* **Logo SVG assets**: Orbit mark SVGs added to `public/` for favicon/OG use

## Key design decisions from the design chat

* **Space Grotesk** chosen over DM Sans for its geometric precision and distinctive apertures
* **JetBrains Mono** for tabular data, metric values, chart ticks, code blocks, and kbd shortcuts only — never body or headings
* **Orbit mark**: circle ring + quarter-arc highlight + center dot, all in `var(--app-accent)` with a drop-shadow glow
* **Wordmark tracking**: locked at 0.14em (down from 0.18em)
* Motion system and additional brand assets are in the bundle for reference but are stretch goals for this ticket

## Context

Helio currently uses Inter as its sole typeface and a muted indigo/slate token palette (`#070b14` dark base, `#8ea0ff` accent). The CSS architecture is
already well-structured: a single `theme.css` owns all `--app-*` tokens, component CSS files consume those tokens exclusively (no hardcoded palette
values except a few red danger colors), and both dark/light themes are applied via `[data-theme]` attribute. This gives us an ideal surface for a surgical
token swap without touching component logic.

The `frontend-design` skill (installed at `~/.claude/skills/frontend-design/SKILL.md`) is the exploration tool — it will prototype at least 3 visual
directions before one is chosen and implemented.

## Goals / Non-Goals

**Goals:**
- Prototype 3+ distinct directions using the design skill, select one winner
- Replace `theme.css` tokens (color, typography, spacing, radius, shadow)
- Add a distinctive font pair via Google Fonts / Fontsource in `index.html`
- Apply per-component aesthetic touches (not just passive token consumption) where the direction demands it
- Update both dark and light themes consistently
- Document the chosen design system in `helio-visual-identity` spec

**Non-Goals:**
- Changing the app layout structure (grid columns, routing, page hierarchy)
- New feature development or component logic changes
- Side-nav structural overhaul (deferred per ticket scope note)
- Backend or API changes

## Decisions

### 1. Token-swap strategy — update `theme.css` + targeted component CSS files

All `--app-*` tokens live in one file. The redesign updates that file and then makes targeted per-component CSS edits where the new aesthetic needs
explicit treatment (e.g., a direction that calls for prominent left-border accents on nav items, or specific card treatments). This keeps the change
auditable and rollback-safe.

Alternative considered: CSS-in-JS or Tailwind migration — rejected; the existing CSS module pattern works well and the change scope doesn't justify
framework migration.

### 2. Font loading via Google Fonts in `index.html`

The `theme.css` `font-family` stack is updated to name the new fonts. Google Fonts `<link>` tags (preconnect + stylesheet) are added to
`frontend/index.html`. If a font is available on npm (Fontsource), that is preferred for offline reliability.

Alternative: Self-hosting woff2 files — acceptable but adds binary assets to the repo; use Fontsource npm packages instead for packages available
there.

### 3. Design direction selection via prototyping

The executor will use the frontend-design skill to produce 3 HTML prototypes (viewable in a browser), evaluate each for distinctiveness,
production-appropriateness, and alignment with a data dashboard context, then select the strongest. The winner's palette, fonts, and component
aesthetic are documented before CSS implementation begins.

### 4. Danger/error colors kept out of theme tokens

The current hardcoded `#f87171` red in `DashboardList.css` for delete confirm is intentionally kept literal (danger is a semantic universal, not
a brand token). The redesign does not move danger states into the brand token system.

### 5. `--app-*` token naming preserved

Renaming all tokens would force touching every component CSS file. The redesign keeps existing token names and only changes their values, minimising diff
surface area and reducing regression risk. New tokens may be added with new names if the direction requires them.

## Risks / Trade-offs

- [Backdrop-filter reliance] Some directions may not read well when backdrop-filter is unsupported → Mitigation: ensure surfaces have an opaque
  fallback via solid background-color behind the blur.
- [Font load flash] Google Fonts can cause FOUT → Mitigation: use `font-display: swap` and a close system fallback in the font stack.
- [Light theme parity] Bold dark directions sometimes produce under-designed light counterparts → Mitigation: treat both themes as first-class;
  evaluator will check light mode explicitly.
- [Test snapshot drift] Jest snapshot tests that encode CSS class names are unaffected; visual snapshots (none currently) would need updating.

## Migration Plan

1. Executor prototypes 3 directions (HTML files, viewable in browser), selects winner.
2. Winner's tokens replace `theme.css`; font links added to `index.html`.
3. Per-component CSS files updated where aesthetic treatment goes beyond passive token consumption.
4. Both themes verified visually; lint and tests pass.
5. No backend deploy needed; frontend-only change.
6. Rollback: revert the branch — no data migrations involved.

## Open Questions

None — design direction selection is delegated to the executor's prototyping phase.

## Planner Notes

Self-approved: no new external service dependencies, no API contract changes, no migration complexity. The risk surface is purely visual — a bad
choice is easily reverted. Executor must consult the frontend-design skill for the prototyping phase.

## Selected Direction

### Evaluation Summary

Three visual directions were prototyped and evaluated against: distinctiveness, production-appropriateness, and dark/light theme parity potential.

**Direction A: Industrial Bold** (`prototypes/direction-a.html`)
- **Fonts**: Outfit (bold geometric sans) + Azeret Mono
- **Palette**: Stark blacks (`#0a0a0a`, `#1a1a1a`), concrete grays, signal orange (`#ff6b35`)
- **Aesthetic**: Brutalist with hard box shadows, diagonal stripe pattern, uppercase monospace labels, geometric rigidity
- **Strengths**: Extremely distinctive, strong signal color works for monitoring/alerting contexts, appropriate for industrial/ops dashboards
- **Weaknesses**: Hard shadows and stark geometry may feel aggressive for extended use; light theme would require significant re-balancing to avoid feeling washed out

**Direction B: Refined Editorial** (`prototypes/direction-b.html`)
- **Fonts**: Playfair Display (elegant serif) + Work Sans (clean sans)
- **Palette**: Deep charcoal/ink (`#0f1419`, `#1a1f26`), gold accent (`#d4af37`), cream highlights
- **Aesthetic**: Elegant with soft shadows, backdrop blur, radial gradient overlays, staggered card entrance animations, refined typography hierarchy
- **Strengths**: Highly distinctive (gold + charcoal is uncommon in SaaS), sophisticated without being over-designed, serif display font creates editorial quality while remaining professional for data work, excellent dark/light parity potential (gold reads equally well on light backgrounds)
- **Weaknesses**: None significant — balances all evaluation criteria

**Direction C: Warm Expressive** (`prototypes/direction-c.html`)
- **Fonts**: Fraunces (expressive variable serif with optical sizing) + DM Sans
- **Palette**: Warm earth tones (terracotta `#e07856`, sage `#97a97c`, clay `#3d2e26`)
- **Aesthetic**: Organic with noise texture overlay, radial gradients, bouncy cubic-bezier animations, italic serif headings, rounded corners
- **Strengths**: Very warm and approachable, unique color palette, high expressiveness
- **Weaknesses**: Warm earth tones harder to translate to light theme while preserving character; bouncy animations and italic display font may be too expressive for serious data/dashboard work; noise texture might distract from data visualization

### Winner: Direction B — Refined Editorial

**Rationale**: Direction B best balances distinctiveness with production-appropriateness for a data dashboard builder. The gold + charcoal palette is memorable and signals quality without being common in SaaS tools. Playfair Display as a display font creates an editorial, refined identity that differentiates Helio from generic dashboard tools while remaining professional and appropriate for data-focused work. The palette translates equally well to both dark and light themes, ensuring parity.

### Design Tokens (Direction B)

#### Typography
- **Display font**: `Playfair Display` — weights 400, 600, 700, 900
- **Body font**: `Work Sans` — weights 300, 400, 500, 600
- **Font stack**: `'Playfair Display', Georgia, serif` (display), `'Work Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` (body)
- **Display settings**: Use Playfair Display for large headings (h1, h2), panel titles; Work Sans for body text, labels, UI chrome

#### Dark Theme Palette
- `--app-bg`: `#0f1419` (deep ink)
- `--app-bg-accent`: `rgba(212, 175, 55, 0.08)` (subtle gold wash)
- `--app-surface`: `rgba(42, 48, 56, 0.6)` (charcoal glass)
- `--app-surface-strong`: `rgba(26, 31, 38, 0.9)` (strong charcoal)
- `--app-surface-soft`: `rgba(42, 48, 56, 0.78)` (soft slate)
- `--app-text`: `#fdfbf7` (cream)
- `--app-text-muted`: `#8a919a` (slate gray)
- `--app-accent`: `#d4af37` (gold)
- `--app-accent-strong`: `#f4d98d` (bright gold)
- `--app-accent-surface`: `rgba(212, 175, 55, 0.12)` (gold tint)
- `--app-border-strong`: `rgba(212, 175, 55, 0.35)` (gold border)
- `--app-border-subtle`: `rgba(212, 175, 55, 0.12)` (faint gold)

#### Light Theme Palette
- `--app-bg`: `#fdfbf7` (cream)
- `--app-bg-accent`: `rgba(212, 175, 55, 0.1)` (gold wash)
- `--app-surface`: `rgba(255, 255, 255, 0.85)` (white glass)
- `--app-surface-strong`: `rgba(255, 255, 255, 0.96)` (strong white)
- `--app-surface-soft`: `rgba(245, 242, 237, 0.9)` (parchment)
- `--app-text`: `#0f1419` (ink)
- `--app-text-muted`: `#6b7280` (muted gray)
- `--app-accent`: `#9d8456` (muted gold)
- `--app-accent-strong`: `#7a6638` (dark gold)
- `--app-accent-surface`: `rgba(157, 132, 86, 0.12)` (gold tint)
- `--app-border-strong`: `rgba(157, 132, 86, 0.3)` (gold border)
- `--app-border-subtle`: `rgba(157, 132, 86, 0.1)` (faint gold)

#### Shared Tokens
- `--app-radius-sm`: `4px` (reduced from 12px for refined feel)
- `--app-radius-md`: `8px` (reduced from 18px)
- `--app-radius-lg`: `16px` (reduced from 28px)
- `--app-shadow-soft`: `0 20px 60px rgba(15, 20, 25, 0.15), 0 4px 12px rgba(15, 20, 25, 0.08)` (layered elegant shadow)
- `--app-shadow-card`: `0 8px 24px rgba(15, 20, 25, 0.12)` (soft card shadow)
- `--app-transition`: `0.3s cubic-bezier(0.4, 0, 0.2, 1)` (refined easing, slightly longer)

#### Aesthetic Guidelines
- **Backdrop blur**: Use `backdrop-filter: blur(16px-20px)` on surfaces with semi-transparent backgrounds for depth
- **Gradients**: Subtle radial gradients on hover states for panels; linear gradients for text (heading treatments)
- **Typography scale**: Use larger, bolder Playfair Display for page headings (4-5rem); reduce to 1.5-2rem for card/panel titles
- **Animations**: Staggered entrance animations for cards (`animation-delay` increments); smooth hover lifts with `translateY(-4px)`
- **Nav accent**: Vertical gold bar on left side of active nav links (3px wide, 60-80% height)
- **Button treatment**: Pill-shaped borders (`border-radius: 24px`) for secondary/ghost buttons; maintain subtle borders with gold hover states

### Font Loading

Add to `frontend/index.html` `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=Work+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
```

Alternatively, use Fontsource npm packages if available for offline support.

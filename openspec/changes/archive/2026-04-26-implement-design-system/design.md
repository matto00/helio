## Context

The frontend currently uses DM Sans loaded via Google Fonts in `frontend/index.html`, set as the root `font-family` in `frontend/src/theme/theme.css`. The command bar and sidebar each have a `.app-command-bar__logo-dot` / `.app-sidebar__logo-dot` element styled as a plain colored dot. Wordmark letter-spacing is hard-coded at 0.18em in `App.css` (both command bar and sidebar). Several components use bare `font-family: monospace` instead of a design token. No type scale, spacing scale, or utility classes exist yet in `theme.css`.

## Goals / Non-Goals

**Goals:**
- Replace DM Sans with Space Grotesk + JetBrains Mono everywhere the app declares fonts
- Introduce a `--font-mono` token and apply it consistently to monospace contexts
- Land the full design token set (type scale, spacing scale, semantic roles, brand vars) in `theme.css`
- Replace the dot placeholder with the Orbit SVG mark in the command bar (the sidebar can be updated if it also has a logo slot)
- Update wordmark tracking to 0.14em in App.css
- Add `.eyebrow`, `.wordmark`, `.mono` utility classes to `theme.css`
- Add Orbit mark SVG to `frontend/public/` for favicon/OG use

**Non-Goals:**
- Light/dark theme color changes — existing `--app-*` palette tokens are already correct per prior identity work
- Backend changes
- Motion system implementation

## Decisions

### Font loading via Google Fonts (unchanged mechanism)
The existing approach uses a `<link>` in `index.html` to load from Google Fonts. We extend the same pattern to add Space Grotesk and JetBrains Mono. This avoids a new dependency on Fontsource/npm packages for a purely visual change.

Alternatives considered: Fontsource npm packages — requires an install + import in JS bundle, adds weight and complexity. Google Fonts CDN is already the established pattern.

### CSS custom property for mono font (`--font-mono`)
Rather than spreading `"JetBrains Mono"` as a literal string in component CSS, define `--font-mono` in `:root` in `theme.css` alongside the existing font-family declaration. Existing bare `font-family: monospace` references in `TypeDetailPanel.css`, `ComputedFieldsEditor.css`, and `AddSourceModal.css` are updated to `var(--font-mono)`.

### Token naming follows `colors_and_type.css` exactly
The design handoff bundle is the source of truth for token names. We import its type scale, spacing scale, semantic role, and brand variables verbatim under the existing `:root` block in `theme.css`. This prevents drift between the handoff and the codebase.

### Orbit SVG mark inlined as JSX in App.tsx
The logo-dot `<span>` is replaced with an inline SVG component (or a small `OrbitMark.tsx` component) so the glow effect (`drop-shadow` filter using `var(--app-accent)`) inherits the live CSS variable and responds to theme switches. No external `.svg` file import needed for the in-app mark; the `public/` copy is only for static favicon/OG use.

Alternatives considered: `<img src="/orbit-mark.svg">` — does not support CSS variable-driven colors.

### Wordmark tracking update in App.css (not extracted to theme.css)
The 0.18em → 0.14em change applies to `.app-command-bar__wordmark` and `.app-sidebar__wordmark` in `App.css`. If a `.wordmark` utility class is added to `theme.css`, the App.css selectors can `composes` or simply duplicate the single property. We apply it directly in `App.css` to avoid cascading specificity issues with existing rules.

## Risks / Trade-offs

- [Google Fonts fetch failure] → Fallback stack in `font-family` catches this; Space Grotesk falls back to system-ui/sans-serif.
- [Space Grotesk metrics vs DM Sans] → Slightly different x-height may shift line heights by a pixel or two in some panels. Accept as cosmetic and monitor.
- [JetBrains Mono in panel stat values] → Requires identifying the correct CSS selectors across panel type components. Risk: missing some stat displays. Mitigation: grep for numeric value containers in panel components.

## Migration Plan

1. Update `index.html` — swap Google Fonts URL
2. Update `theme.css` — font stack, `--font-mono`, token set, utility classes
3. Update `App.css` — wordmark tracking, logo-dot replacement prep
4. Update `App.tsx` — swap logo-dot span for OrbitMark SVG component
5. Update `TypeDetailPanel.css`, `ComputedFieldsEditor.css`, `AddSourceModal.css` — bare monospace → `var(--font-mono)`
6. Update panel stat/metric value elements — apply `var(--font-mono)` + `font-variant-numeric: tabular-nums`
7. Add `orbit-mark.svg` (and variants) to `frontend/public/`
8. Run lint + tests; commit

Rollback: revert the Google Fonts link and `theme.css` changes; all other changes are additive CSS variable references.

## Planner Notes

Self-approved: this is a pure frontend styling change with no API surface, no new external services beyond an additional Google Fonts family, and no breaking changes to existing behavior or contracts.

## Open Questions

- The design handoff bundle URL requires fetching at implementation time to get exact token values from `colors_and_type.css`. The executor must fetch `https://api.anthropic.com/v1/design/h/CHNxGF72tqOy6t_LC9p4ng` and decompress it to read the source-of-truth CSS.
- The sidebar also has a logo-dot (`app-sidebar__logo-dot`). The ticket focuses on the command bar, but the sidebar dot should be updated for consistency. The executor should update both.

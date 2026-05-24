# HEL-259 — Color customization UX: make finding working combinations easier

## Title
Color customization UX — make finding working combinations easier

## Description
The accent-mix color blending introduced in HEL-235 produces beautiful results, but discovering a combination that actually looks good is hard. The user picks colors and most combinations look muddy or low-contrast.

## Possible approaches (decided during planning: implement all three)

* **Curated presets**: 8-12 hand-tuned accent + background + grid-background triples. One-click apply in the dashboard appearance editor.
* **Contrast guidance**: warn when the picked combination drops below a WCAG contrast threshold for text/border on the chosen background.
* **Live preview**: a small swatch widget showing how UI tokens (input border, button, hover state) look against the chosen colors, before applying.

## Decision
Implement all three approaches:
1. Add dashboard appearance presets (curated bg + gridBg triples) to `DashboardAppearanceEditor` — on the same level as existing accent presets already in `UserMenu`/`AccentPicker`.
2. Add contrast warning to `DashboardAppearanceEditor` when text contrast would drop below WCAG AA (4.5:1).
3. Extend the existing swatch preview in `DashboardAppearanceEditor` to show a richer live preview of the resolved blended colors.

## Scope
- Frontend-only: no API, no backend changes, no schema changes needed.
- `appearance.ts` already has `getContrastRatio` and color blending — reuse heavily.
- New preset data structure in `theme.ts` (similar to `ACCENT_PRESETS`).
- `DashboardAppearanceEditor.tsx` + `.css` — main UI work.
- New test coverage for preset application logic.

## Definition of Done
* A new user can produce a good-looking dashboard accent in under 30 seconds without trial and error
* Existing custom accent settings preserved (no data migration)
* Curated presets visible in the appearance editor
* Contrast warning shown when current selection is low-contrast
* Live preview swatches show the resolved (blended) color, not the raw picker value

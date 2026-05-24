## Why

The accent-blend system (HEL-235) makes dashboards look great once you find a working combination,
but discovery is hard — most random pairings produce muddy or low-contrast results. Users need
guardrails: curated presets, live feedback on the blended result, and contrast warnings.

## What Changes

- Add a `DASHBOARD_APPEARANCE_PRESETS` constant to `theme.ts` — 8 hand-tuned background + gridBackground hex triples.
- Extend `DashboardAppearanceEditor` with a preset strip above the manual color pickers; one-click applies all fields.
- Upgrade the existing swatch row to show the *resolved* (blended) color rather than the raw picker value, giving accurate live preview.
- Add an inline contrast warning when the resolved background produces < 4.5:1 contrast against default text,
  surfacing the WCAG AA threshold before the user saves.

## Capabilities

### New Capabilities
- `dashboard-appearance-presets`: Curated preset palette for dashboard background + grid-background; one-click apply in the appearance editor.

### Modified Capabilities
- `dashboard-appearance-settings`: Editor now shows resolved live-preview swatches and a contrast warning.

## Impact

- Frontend-only: `theme.ts`, `appearance.ts`, `DashboardAppearanceEditor.tsx/.css`.
- No API, schema, or backend changes.
- Existing saved appearances are untouched (presets write the same fields already supported).

## Non-goals

- No new backend endpoints or persistence schema.
- No accent color presets (those live in `UserMenu`/`AccentPicker` which already exist).
- No automated color generation or ML-based palette suggestions.

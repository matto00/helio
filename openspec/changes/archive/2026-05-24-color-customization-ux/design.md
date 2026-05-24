## Context

`DashboardAppearanceEditor` already manages background + gridBackground colors via `<input type="color">`.
`appearance.ts` provides `resolveDashboardBackground`, `resolveDashboardGridBackground`, and `getContrastRatio` (which already powers `resolvePanelTextColor`). `theme.ts` has `ACCENT_PRESETS` as a proven pattern for named palettes.

The editor currently shows raw color swatches — they reflect the picker values, not the blended result the
user will see. Contrast checking exists in `appearance.ts` but is only used internally for text selection.

## Goals / Non-Goals

**Goals:**
- Preset strip: 8 named (bg + gridBg) pairs, one-click apply.
- Live-preview swatches: show the blended resolved color instead of the raw hex.
- Contrast warning: inline, dismissible, shown when resolved background drops below WCAG AA (4.5:1) against
  the theme's default text color.

**Non-Goals:**
- No accent-color presets in the editor (AccentPicker in UserMenu covers that).
- No backend or schema changes.
- No automated palette generation.

## Decisions

### D1 — Preset data in `theme.ts` alongside `ACCENT_PRESETS`
`DASHBOARD_APPEARANCE_PRESETS` follows the same shape: `{ label, background, gridBackground }`.
Keeps all palette data in one file, consistent with the existing pattern.

### D2 — Resolved preview using `resolveDashboardBackground` / `resolveDashboardGridBackground`
Call the same functions used by the live dashboard, passing the editor's current theme context.
The editor needs `theme` from `useTheme()`; it is already accessible via the hook.

### D3 — Contrast check against theme default text
Use `getContrastRatio` (already exported from `appearance.ts`) between the *resolved* background and the
theme's default text color (`#edf2ff` dark / `#101828` light). Threshold: < 4.5 (WCAG AA). Show the
warning below the color pickers, above the Save button. No auto-block — the user can still save.

### D4 — Theme threading in `DashboardAppearanceEditor`
The editor currently has no theme access. Add `useTheme()` call inside the component. This is consistent with
`buildPanelSurface` callers in panel editors.

## Risks / Trade-offs

- [Contrast warning is imprecise for transparent] When `background === "transparent"`, no warning is shown
  since the theme's own background is used — which is always legible. → Mitigation: skip warning when `background === "transparent"`.

## Planner Notes

Self-approved: frontend-only, no API changes, no new dependencies. The contrast check reuses existing
`getContrastRatio` utility — no new math. Preset data is static, so no testing burden beyond a snapshot test.

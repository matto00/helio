## 1. Frontend — Data

- [x] 1.1 Add `DashboardAppearancePreset` interface and `DASHBOARD_APPEARANCE_PRESETS` constant to `theme.ts` (8 hand-tuned bg + gridBg triples)
- [x] 1.2 Export `DASHBOARD_APPEARANCE_PRESETS` so it can be consumed by `DashboardAppearanceEditor`

## 2. Frontend — Editor

- [x] 2.1 Add `useTheme()` call inside `DashboardAppearanceEditor` to access current theme for live preview and contrast check
- [x] 2.2 Upgrade existing swatch row to show resolved blended colors via `resolveDashboardBackground` / `resolveDashboardGridBackground`
- [x] 2.3 Add preset strip above the manual color pickers using `DASHBOARD_APPEARANCE_PRESETS`
- [x] 2.4 Add contrast warning below the color pickers (shown when resolved bg contrast < 4.5:1 against theme default text, hidden when background is transparent)
- [x] 2.5 Update `DashboardAppearanceEditor.css` — styles for preset strip, preset swatch, selected preset state, and contrast warning

## 3. Tests

- [x] 3.1 Add unit tests in `appearance.test.ts` or a new `theme.test.ts` covering: preset count >= 6, each preset has valid hex values
- [x] 3.2 Add/extend `DashboardAppearanceEditor` tests: preset click applies bg + gridBg fields, contrast warning appears for known low-contrast input, warning absent when background is transparent

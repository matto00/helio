## 1. Frontend — preserve sentinel through save

- [x] 1.1 In `PanelDetailModal.tsx`, seed `background` / `color` state from the raw `panel.appearance.background` / `.color` (may be sentinel), not the pre-resolved fallback hex; `initialBackground` / `initialColor` likewise hold the raw value.
- [x] 1.2 Resolve to a display hex only at the `<AppearanceEditor>` boundary via `getColorInputValue(..., panelAppearanceEditorFallback / panelTextEditorFallback)`; pass `setBackground` / `setColor` through unwrapped.
- [x] 1.3 In `handleEditSubmit`, build `appearance.background` / `appearance.color` directly from the `background` / `color` state (raw sentinel when untouched, chosen hex when edited).
- [x] 1.4 Confirm `resetFormToPanel` re-seeds the raw value; verify `appearanceDirty` still compares correctly against the raw initial values.
- [x] 1.5 Confirm transparency and chart appearance payload construction are unchanged (no sentinel there).

## 2. Tests

- [x] 2.1 Regression test: panel with `background: "transparent"` + edit an unrelated field + save → payload keeps `background: "transparent"`.
- [x] 2.2 Regression test: panel with `color: "inherit"` untouched → payload keeps `color: "inherit"`.
- [x] 2.3 Regression test: picking a background color → payload carries the chosen hex (sentinel not restored).
- [x] 2.4 Regression test: switching panels remounts (`key={panel.id}`) so a transparent panel opened after a hex panel still saves `"transparent"` — mount with a changing `key`, mirroring the real parent usage, not a re-render of the same instance.
- [x] 2.5 Run gates: `npm run lint`, `npm test`, `npm run format:check` (root) and `npm run build` (frontend/).

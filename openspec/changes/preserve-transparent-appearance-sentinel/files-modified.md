# Files modified — HEL-322

- `frontend/src/features/panels/ui/PanelDetailModal.tsx` — seed `background` / `color` (and `initialBackground` / `initialColor`, `resetFormToPanel`) from the RAW `panel.appearance` value instead of pre-resolving through `getColorInputValue`; resolve to a display-safe hex only at the `<AppearanceEditor>` prop boundary. This preserves an untouched `"transparent"` / `"inherit"` sentinel through the full-replacement save payload.
- `frontend/src/features/panels/ui/PanelDetailModal.appearanceSentinel.test.tsx` — new regression suite: untouched transparent background stays `"transparent"`, untouched inherit text color stays `"inherit"`, an explicitly picked color persists as its hex, and a key-driven panel-switch remount preserves the sentinel.

## Root-cause evidence (systematic-debugging)

- **Root cause (UI/state-seed layer):** `PanelDetailModal` seeded its `background` / `color` state via `getColorInputValue(panel.appearance.*, fallbackHex)`, which substitutes a fallback hex for any non-hex sentinel; the appearance PATCH is a full replacement built directly from that state, so an untouched `"transparent"` was persisted as `#1a1816`.
- **Probe:** `node -e` replaying `getColorInputValue("transparent", "#1a1816")`.
- **Probe output:** `stored: transparent -> state/payload background: #1a1816` (BUG confirmed: true). Confirmed again at the test layer — 3 of the 4 new tests fail against pre-fix `PanelDetailModal.tsx` (`Expected "transparent", Received "#1a1816"`), all 4 pass after the fix.

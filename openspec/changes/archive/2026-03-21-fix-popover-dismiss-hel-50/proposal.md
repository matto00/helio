## Why

All floating UI elements (popovers and dropdown menus) lack Escape key handling and have no coordination with each other, so multiple overlays can stack visibly on screen simultaneously — degrading usability and violating standard interaction expectations.

## What Changes

- Add Escape key dismiss to all popover and dropdown components (`ActionsMenu`, `DashboardAppearanceEditor`, `PanelAppearanceEditor`)
- Introduce mutual exclusion: opening any overlay closes all others
- Implement via a lightweight `OverlayProvider` context that manages a single active overlay ID globally

## Capabilities

### New Capabilities
- `overlay-management`: Global overlay coordination — single active overlay at a time, Escape key dismiss, click-outside dismiss consistency across all floating UI elements

### Modified Capabilities

## Impact

- `frontend/src/components/OverlayProvider.tsx` — new file
- `frontend/src/components/ActionsMenu.tsx` — use overlay context instead of local state
- `frontend/src/components/DashboardAppearanceEditor.tsx` — use overlay context instead of local state
- `frontend/src/components/PanelAppearanceEditor.tsx` — use overlay context (uncontrolled mode) + Escape listener (controlled mode)
- `frontend/src/main.tsx` — wrap app with `OverlayProvider`
- No API or schema changes; purely frontend interaction behavior

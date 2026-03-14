## Why

The app now has the core dashboard selection flow, but it still looks like a starter interface rather than a polished product. `HEL-15` adds a professional visual pass with a reusable dark/light theme system so Helio feels modern, premium, and ready for future customization work without mixing in full user-configurable appearance controls yet.

## What Changes

- Add a reusable frontend theme system with dark mode as the default and a user-toggleable light/dark switch.
- Persist the selected theme across reloads.
- Introduce shared design tokens with CSS variables for colors, surfaces, spacing, radii, and shadows.
- Redesign the app shell, sidebar, dashboard list, and panel content with a more polished modern dashboard look.
- Expand the dashboard layout to use the full browser width so the main dashboard area dominates the screen.
- Add a `react-grid-layout` foundation for future freely placed and resizable panel layouts.
- Use rounded surfaces, restrained motion, and remove heavy UI-library-style click animations.
- Keep the styling modular so future appearance customization can layer on top of the same token system.
- Explicitly defer per-dashboard and per-panel appearance customization controls to `HEL-16`.

## Capabilities

### New Capabilities
- `frontend-theme-system`: Provide a reusable light/dark theme system with persistent user preference.
- `frontend-dashboard-polish`: Render the current dashboard experience with a more polished, modern visual treatment.
- `frontend-panel-grid-foundation`: Provide a reusable grid-layout foundation for future flexible panel placement.

### Modified Capabilities
- `frontend-dashboard-selection-flow`: Present the existing selection flow inside a more structured and polished UI shell.

## Impact

- `frontend/src/app/**`
- `frontend/src/components/**`
- `frontend/src/main.tsx`
- new frontend theme utilities and styling modules
- frontend tests covering theme toggle and polished shell behavior

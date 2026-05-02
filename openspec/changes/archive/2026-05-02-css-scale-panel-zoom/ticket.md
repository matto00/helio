# HEL-151 — Apply CSS scale transform to panel grid at zoom level

## Title
Apply CSS scale transform to panel grid at zoom level

## Description
Apply a CSS scale transform to the panel grid container based on the current zoom level from Redux state. All panels and their content scale proportionally.

## Acceptance Criteria
- A CSS `scale(zoomLevel)` transform is applied to the panel grid container div
- `transform-origin: top left` so scaling anchors at the top-left corner
- The container compensates for the scale by expanding its logical dimensions:
  - `width: 100% / zoomLevel` (so after scaling it fills the viewport width)
  - `height: 100% / zoomLevel` (so after scaling it fills the viewport height)
- The parent container clips overflow so zoomed-in content does not spill outside the panel area
- The zoom controls (zoom in, zoom out, reset) are present in the header when a dashboard is selected
- The zoom level is restored from user preferences (`currentUser.preferences.zoomLevels[dashboardId]`) when the dashboard changes
- Zoom level is persisted to the backend via `updateUserPreferences` when changed
- Range: 0.5 (50%) to 2.0 (200%) in 0.1 increments
- Zoom level display is shown as a percentage (e.g. `100%`)
- All zoom-related CSS classes have appropriate styles in `PanelList.css`
- All existing tests pass; new tests cover the scale transform and CSS compensation

## Parent Epic
HEL-134 — Dashboard Zoom

## Context from Prior Audit
HEL-157 already implemented a CSS scale transform on the panel grid in `PanelList.tsx` (lines 239-248), reading from component-local state. The zoom level is also persisted to the backend via user preferences. The remaining work for HEL-151 is to verify the implementation is correct and complete — specifically:
1. The scale transform correctly fills/compensates the container dimensions
2. Missing CSS rules for `.panel-list__zoom-container`, `.panel-list__zoom-controls`, `.panel-list__zoom-button`, `.panel-list__zoom-level`, `.panel-list__zoom-reset` need to be added to `PanelList.css`
3. The `.panel-list` section needs `overflow: hidden` to clip content that overflows when zoomed in
4. A test covering the scale transform DOM output and container compensation should be added

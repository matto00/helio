## Why

The dashboard chrome header feels cluttered: zoom controls, panel count, and the add-panel button
are all packed into one header row with no clear visual hierarchy. Moving zoom controls out of the
header to a floating bottom-right widget gives them a natural home (map-zoom pattern) and leaves
the header clean for contextual actions (count + add).

## What Changes

- Move zoom controls (zoom in/out/reset + level label) from the header to a floating widget
  anchored to the bottom-right corner of the dashboard panel area.
- Keep the create-panel button inline with the panel-count indicator (right of the count), removing
  the separate `panel-list__panel-actions` wrapper as needed.
- Reduce visual weight of the panel-count chip if needed (smaller pill, muted palette).
- Tighten the spacing between the panel-grid edge and the chrome header.
- Minor nits: consistent gap/padding values, responsive clamp so zoom widget doesn't overlap content
  on narrow viewports.

## Capabilities

### New Capabilities

- `dashboard-chrome-zoom-widget`: Floating bottom-right zoom control widget in the dashboard panel
  area, with ARIA landmark and keyboard-accessible buttons.

### Modified Capabilities

- `dashboard-zoom`: Zoom controls are no longer in the header; the widget moves to a floating
  bottom-right overlay. Spec requirements for "appear in header" change to "appear as floating
  overlay when a dashboard is selected." All other zoom requirements (range, persistence, gesture)
  remain unchanged.
- `frontend-dashboard-polish`: Header layout now shows only count + add, not zoom controls.

## Impact

- `frontend/src/features/panels/ui/PanelList.tsx` — restructure header markup; add floating zoom
  widget div.
- `frontend/src/features/panels/ui/PanelList.css` — new `.panel-list__zoom-widget` and related
  rules; adjust header spacing.
- `frontend/src/features/panels/ui/PanelList.test.tsx` — update zoom control tests to reflect new
  position (aria-labels stay the same; no structural assertions change).

## Non-goals

- No change to zoom range, persistence, or gesture behaviour.
- No auto-hide on inactivity (noted as exploratory; deferred — no clear UX consensus).
- No backend changes.

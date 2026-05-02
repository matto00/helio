# HEL-152 — Zoom gesture support (Ctrl+scroll and pinch)

## Description

Ctrl+scroll on desktop and pinch on trackpad adjust zoom level, snapping to the nearest discrete step. Should feel natural and not conflict with page scroll.

## Context (from slash command)

Zoom controls (+/−/reset) already exist in PanelList.tsx via handleZoomChange(delta). HEL-152 adds Ctrl+scroll and pinch-to-zoom gesture support that snaps to the nearest discrete step, without conflicting with page scroll.

## Acceptance Criteria

- Ctrl+wheel (desktop) adjusts zoom level, snapping to the nearest discrete step
- Pinch gesture (trackpad / touch) adjusts zoom level, snapping to the nearest discrete step
- Neither gesture conflicts with normal page scroll (i.e., plain scroll still scrolls the page)
- The gesture behavior reuses the existing handleZoomChange(delta) mechanism in PanelList.tsx
- Zoom feels natural (appropriate sensitivity, correct direction)

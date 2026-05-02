# HEL-153 — Verify grid editing at non-100% zoom levels

## Title
Verify grid editing at non-100% zoom levels

## Description
Confirm that panel drag, resize, and all editing interactions remain functional at 50%, 75%, 125%, and 150% zoom. Fix any hit-target or coordinate offset issues caused by the scale transform.

## Context
The panel grid uses react-grid-layout with a CSS scale() transform applied at the PanelList level. HEL-153 verifies (and fixes if needed) that panel drag, resize, and all editing interactions work correctly at 50%, 75%, 125%, and 150% zoom — hit targets and coordinate offsets may be affected by the scale transform.

## Acceptance Criteria
- Panel drag works correctly at 50%, 75%, 125%, and 150% zoom levels
- Panel resize works correctly at all non-100% zoom levels
- All editing interactions (rename, delete, context menu) work correctly at all zoom levels
- Hit targets are accurate despite the CSS scale() transform
- Coordinate offsets are correctly compensated for the scale transform
- No regressions at 100% zoom

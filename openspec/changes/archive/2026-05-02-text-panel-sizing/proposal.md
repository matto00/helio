## Why

The text panel renders content at a fixed `0.9rem` regardless of panel size, leaving most of the
panel area unused when a panel is tall or wide. The metric panel already scales its value font-size
via CSS container queries; the text panel should follow the same pattern so content fills the
available space appropriately.

## What Changes

- Add a spacious container-query breakpoint to `.panel-content__text-live` that increases font-size
  to `1.1rem` when the panel container height is >= 280px
- The existing compact breakpoint (`height < 180px` → `0.78rem`) is already defined; no change needed
- The base `0.9rem` at default height (180px–279px) remains; the compact breakpoint is also already in place
- Add `overflow: hidden` / `overflow-y: auto` to `.panel-content--text` so long content does not
  overflow the panel card boundaries when font-size grows

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `panel-container-queries`: add text panel spacious breakpoint rule
  (`@container panel-card (min-height: 280px)` → `.panel-content__text-live { font-size: 1.1rem }`)
- `panel-content-sizing`: update text panel sizing requirement to document the spacious breakpoint

## Impact

- `frontend/src/components/PanelContent.css` — one new `@container` rule block
- `frontend/src/components/PanelContent.test.tsx` — tests for text live content at spacious size
- No backend changes, no API changes, no new dependencies

## Non-goals

- Dynamic font scaling that fills the entire panel height (CSS `font-size: fit-content` approach)
- Changes to the text panel placeholder skeleton
- Changes to any other panel type

## Why

The table panel content area does not fill the panel height — the table element does not expand to use available
vertical space and has no overflow scroll, so panels with many rows overflow the card boundary with no
scrollbar. This creates dead space in short tables and broken layout in tall tables. Applying the sizing
system (flex fill + overflow scroll) to `panel-content--table` fixes both problems and brings the table panel
into line with the sizing conventions established for the metric panel.

## What Changes

- `.panel-content--table` gains `flex: 1; align-self: stretch; overflow-y: auto; min-height: 0` so the
  container fills the panel card's content area
- `.panel-content__table-wrapper` (new inner element) wraps the `<table>` and handles overflow — the outer
  `.panel-content--table` div becomes a flex column host; the wrapper takes `flex: 1; overflow-y: auto`
- Alternatively (simpler): the existing `.panel-content--table` div takes `align-items: flex-start;
  justify-content: flex-start; flex-direction: column; overflow-y: auto` so the table starts at the top
  and the div itself scrolls
- Container query compact rule for table cells (`padding: 2px 6px; height: 14px` at `max-height: 179px`)
  already exists — no change needed there

## Capabilities

### New Capabilities
<!-- None — this is a sizing fix for an existing panel type -->

### Modified Capabilities
- `panel-content-sizing`: Table panel sizing requirement updated — the `.panel-content--table` element SHALL
  fill the full available content height and scroll when content exceeds it, replacing the current static
  height behaviour.
- `panel-container-queries`: No additional breakpoints needed; existing compact cell padding rule is correct.

## Non-goals

- Changing table column widths, font sizes, or row appearance beyond what the sizing system requires
- Adding horizontal scroll or sticky header behaviour
- Modifying any panel type other than table
- Backend changes

## Impact

- `frontend/src/components/PanelContent.css` — update `.panel-content--table` layout rules
- `frontend/src/components/PanelContent.tsx` — minor structural change if a wrapper div is needed
- `frontend/src/components/PanelContent.test.tsx` — add/update tests for table fill behaviour
- `openspec/specs/panel-content-sizing/` — delta spec for table panel sizing requirement

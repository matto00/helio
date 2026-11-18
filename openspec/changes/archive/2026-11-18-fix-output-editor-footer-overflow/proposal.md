## Why

At 375px the Output editor's footer is a single non-wrapping flex row of up to four `ui-modal-btn` buttons with a fixed
height. The two-click delete's confirm label ("Confirm delete (removes from N dashboards)") is squeezed into a narrow
column and its text spills out of the fixed-height box (HEL-1733 skeptic screenshot). The same squeeze makes "Add as
tail with aggregate" wrap to three lines. HEL-1733 made this confirm reachable inside a pipeline draft, so more users
now hit it.

## What Changes

- The Output editor sheet's footer row wraps onto more lines when its buttons do not fit, instead of squeezing them.
- Footer buttons in that sheet may grow taller when their label needs a second line, so a label never spills outside
  its button's border box.
- The confirm label keeps its full text, including the dashboard count. No copy change.
- Desktop layout stays a single row (wrapping is a no-op when everything fits).
- Scoped to the Output editor sheet's footer; the shared `ui-modal-btn` recipe for other modals is unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-output-sheet`: adds a requirement that footer action labels are contained by their buttons at 375px.

## Impact

- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css` (footer rules).
- A new Playwright geometry spec at 375px (light + dark) and a desktop no-regression assertion.
- No backend, schema, or migration change.

## Non-goals

- Changing the confirm copy or the two-click delete behavior.
- Changing `.ui-modal-btn` for any other modal.
- Any other Output editor phone-layout issue.

## Why

Panels currently have no direct click-to-edit interaction — users must open the actions menu to reach the detail modal. Clicking the panel body should be a faster, more discoverable path to editing. However, React Grid Layout fires pointer events during drag and resize operations, so a naive `onClick` handler would incorrectly open the modal after every repositioning or resize action.

## What Changes

- A click handler is added to each panel's body element that opens the panel detail modal.
- The handler distinguishes a genuine click (pointer did not move significantly) from a drag or resize (pointer moved beyond a threshold) to suppress false opens.
- Drag handle and resize handle hit areas are excluded from triggering the modal.

## Capabilities

### New Capabilities
- `panel-body-click`: Click the panel body to open the detail modal, with click-vs-drag disambiguation.

### Modified Capabilities
- `panel-detail-modal`: Adds a second open trigger (panel body click) alongside the existing "Customize" actions menu entry.

## Impact

- **Frontend only** — no backend or API changes.
- `PanelCard` (or equivalent panel wrapper component) gains `onMouseDown` / `onMouseUp` / `onClick` logic.
- The existing `PanelDetailModal` open/close Redux state is reused; no new state is required.
- React Grid Layout drag handles must be explicitly excluded (either via CSS pointer-events or by checking event target).

## Non-goals

- No changes to the panel actions menu or any other modal open trigger.
- No backend, schema, or API changes.
- No animation or transition changes to the modal itself.

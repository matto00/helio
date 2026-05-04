## Why

The panel detail modal now defaults to view mode (HEL-174), but users can only enter edit mode via the Edit button click. Adding keyboard shortcuts makes the workflow faster for power users and aligns with standard modal conventions.

## What Changes

- Add a `keydown` listener on the panel detail modal: pressing `E` in view mode transitions to edit mode
- `Esc` in view mode already closes immediately (existing behavior — confirming in spec)
- `Esc` in edit mode with unsaved changes already shows discard confirmation (existing behavior — confirming in spec)
- No backend changes required

## Non-goals

- Keyboard shortcuts for other modal actions (Save, Cancel) — future scope
- Customizable keybindings — future scope

## Capabilities

### New Capabilities

- `panel-detail-keyboard-shortcuts`: Keyboard shortcut handling for the panel detail modal (E key to enter edit mode)

### Modified Capabilities

- `panel-view-mode`: Add the E key shortcut requirement to the existing view mode spec

## Impact

- Frontend only: `PanelDetailModal.tsx` — add one `keydown` event listener
- No API changes
- No schema changes
- No backend changes

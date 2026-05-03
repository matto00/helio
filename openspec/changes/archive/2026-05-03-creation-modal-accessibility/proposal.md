## Why

The creation modal currently lacks keyboard and pointer accessibility: Escape and click-outside do not dismiss it, focus can leave the modal while it is open, and there is no guard against accidentally discarding entered data. These gaps block keyboard-only and assistive-technology users.

## What Changes

- Pressing Escape dismisses the creation modal at any step
- Clicking outside the modal backdrop dismisses it
- If the user has entered data (selected a type, selected a template, or typed a title), a discard confirmation is shown before closing
- Focus is trapped inside the modal while it is open; Tab and Shift+Tab cycle only through modal-internal focusable elements

## Capabilities

### New Capabilities
- `modal-dismiss-interactions`: Escape-key and click-outside-backdrop dismissal for the creation modal, with a dirty-state discard confirmation

### Modified Capabilities
- `panel-creation-modal`: Add Escape / click-outside dismiss scenarios and discard-confirmation requirement; add focus-trap requirement

## Impact

- `frontend/src/components/PanelCreationModal.tsx` (or equivalent modal component) — event handlers, backdrop, focus trap
- No backend changes
- No API changes
- No schema changes

## Non-goals

- Applying focus trapping to other overlays (popovers, dropdowns) — out of scope for this ticket
- Animating the discard confirmation — a plain inline confirm or browser `confirm()` is acceptable

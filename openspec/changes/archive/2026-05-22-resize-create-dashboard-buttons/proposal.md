# Proposal: Resize Create Dashboard Flow Buttons

## Problem

The "Create dashboard" and "Import from file" buttons in the `DashboardList` sidebar panel
use `min-height: 36px`, which is oversized relative to the app's standard button language.
This makes the create form feel bottom-heavy compared to modal footer buttons and other CTAs.

## Solution

Replace `min-height: 36px` on both `.dashboard-list__create-submit` and
`.dashboard-list__import-label` with `padding: 6px 14px`, matching the established
`.ui-modal-btn` standard from `Modal.css`. Set `font-size: 0.82rem` on both to
match the modal footer button typography.

The text input (`.dashboard-list__create-input`) and rename input retain their
`min-height: 36px` — inputs warrant taller touch targets than action buttons.

## Acceptance criteria

- Buttons match the `.ui-modal-btn` scale (`padding: 6px 14px`, `font-size: 0.82rem`)
- No regressions to existing test suite
- `min-height: 36px` removed from both action buttons (not from inputs)

# HEL-175 — Edit mode toggle and keyboard shortcut

## Description

Edit mode toggle button in the modal header. Keyboard shortcut E switches from view mode to edit mode. Esc in view mode closes the modal; Esc in edit mode with unsaved changes prompts for discard confirmation.

## Acceptance Criteria

- There is an edit mode toggle button in the panel detail modal header
- Pressing the keyboard shortcut E while in view mode switches the modal to edit mode
- Pressing Esc while in view mode closes the modal
- Pressing Esc while in edit mode with unsaved changes prompts the user for discard confirmation

## Context

- Parent ticket: HEL-139 (Panel System)
- Project: Helio v1.2 — Panel System
- Priority: High
- Linear URL: https://linear.app/helioapp/issue/HEL-175/edit-mode-toggle-and-keyboard-shortcut

## Related Prior Work

- HEL-174 added view mode as the default opening state for the panel detail modal (PanelDetailModal)
- The modal has a toolbar with navigation controls

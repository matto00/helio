# HEL-177 — Explicit Save / Cancel in edit mode

## Description

Changes in edit mode do not auto-save. Save button commits all changes via the API. Cancel button (or Esc with confirmation) discards changes and returns to view mode. Unsaved changes indicator shown in the modal header.

## Acceptance Criteria

- Changes in edit mode do not auto-save
- Save button commits all changes via the API
- Cancel button (or Esc with confirmation) discards changes and returns to view mode
- Unsaved changes indicator shown in the modal header

## Context

- Parent ticket: HEL-139
- Project: Helio v1.2 — Panel System
- Priority: High

## Related Prior Work

- HEL-175 introduced the edit mode toggle with a keyboard shortcut (e key)
- HEL-174 added the view mode as default opening state for panel detail modal
- The panel detail modal has view mode and edit mode states
- Edit mode likely involves fields for panel title, data source configuration, etc.

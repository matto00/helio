## Why

The panel detail modal currently opens directly into editing controls (Appearance/Data tabs). Users who simply want to inspect a panel's content must wade through editing UI they don't need. View mode gives every user — regardless of permission level — a clean, full-size read-only render of the panel the moment the modal opens.

## What Changes

- The panel detail modal gains a **view mode** as its default opening state
- View mode fills the available modal area with the panel's rendered content
- No editing controls (tabs, rename field, type picker, settings) are visible in view mode
- A visible affordance (e.g. an "Edit" button or icon) lets users with write permission switch to edit mode from view mode
- The change is purely frontend — no new API endpoints or backend changes required

## Non-goals

- Edit mode itself (tabs, save/cancel flow) is not being redesigned
- Permission enforcement at the API layer is out of scope for this ticket
- Data-connected live content rendering is out of scope (placeholder remains)

## Capabilities

### New Capabilities

- `panel-view-mode`: Read-only full-size panel content render as the default modal state, with a transition affordance to edit mode

### Modified Capabilities

- `panel-detail-modal`: The modal now defaults to view mode on open rather than the Appearance tab; the existing edit-mode behaviour (tabs, save/cancel) is unchanged but becomes a secondary state

## Impact

- `frontend/src/components/` — `PanelDetailModal` or equivalent component gains a mode toggle (view vs edit)
- `openspec/specs/panel-detail-modal/spec.md` — updated to reflect view-mode-first open behaviour
- No backend changes, no schema changes, no new API routes

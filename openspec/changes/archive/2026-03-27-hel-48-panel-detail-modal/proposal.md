## Why

The current "Customize" panel UX is a popover rendered inside the grid card. This causes stacking/overflow issues, doesn't dismiss on Escape or click-outside reliably, and is too cramped to host future configuration surfaces like data binding. A proper full-screen modal solves all of these and provides the structural foundation for HEL-49 (data binding).

## What Changes

- A new `PanelDetailModal` component replaces `PanelAppearanceEditor` as the "Customize" entry point in `PanelGrid`
- The modal renders via a React portal to `document.body`, avoiding all z-index/overflow constraints
- Two tabs: **Appearance** (existing background/text color/transparency controls migrated from the popover) and **Data** (placeholder: "Connect a data source to display real content")
- Dismiss on Escape, click-outside (backdrop), or Cancel button; if the form is dirty an inline warning is shown before discarding
- Save persists the appearance via the existing `updatePanelAppearance` thunk
- `PanelAppearanceEditor` component is removed; `PanelGrid` updated to open the modal in place of the old popover

## Capabilities

### New Capabilities

- `panel-detail-modal`: A full-screen modal with title, tab bar, tabbed content areas, footer actions, backdrop dismiss, and Escape dismiss

### Modified Capabilities

- `frontend-resource-appearance-editing`: The appearance editing surface moves from a popover to the Appearance tab of the panel detail modal; the controls and save behaviour are unchanged

## Impact

- `frontend/src/components/PanelDetailModal.tsx` (new) — modal shell, tab routing, portal rendering
- `frontend/src/components/PanelDetailModal.css` (new) — modal styles
- `frontend/src/components/PanelAppearanceEditor.tsx` — deleted
- `frontend/src/components/PanelAppearanceEditor.css` — deleted
- `frontend/src/components/PanelGrid.tsx` — "Customize" action opens `PanelDetailModal` instead
- No backend, Redux, or schema changes

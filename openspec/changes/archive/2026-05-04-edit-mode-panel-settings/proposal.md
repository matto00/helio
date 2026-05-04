## Why

The panel detail modal currently exposes edit controls across tabs but hides them in view mode behind an "Edit" button transition, and a separate customization popover duplicates some appearance settings. Consolidating all panel configuration into a single edit mode eliminates that duplication and gives users one consistent place to configure appearance, data binding, field mapping, and refresh interval.

## What Changes

- The "Edit" button in the panel detail modal's view mode header transitions the modal to edit mode, which now shows a unified settings panel with all configuration sections
- Edit mode presents four sections: Appearance (title, colors, border), Data Binding (DataType selection), Field Mapping (per-slot field dropdowns), and Refresh Interval
- The existing customization popover is removed — all panel configuration is now exclusively in the edit mode of the panel detail modal
- The tab bar inside the modal is replaced by a single scrollable settings layout in edit mode (no more separate Appearance / Data tabs at the top)

## Capabilities

### New Capabilities

- `panel-edit-mode`: Unified edit mode within the panel detail modal that consolidates appearance settings, data binding, field mapping, and refresh interval into a single scrollable form. Replaces the tab-bar layout for the editing surface.

### Modified Capabilities

- `panel-view-mode`: Edit button behavior is unchanged, but the transition now leads to the new unified edit mode instead of the old tabbed edit layout.
- `frontend-resource-appearance-editing`: Appearance controls move into the new unified edit mode form; the customization popover entry point is removed.
- `panel-datatype-binding`: Data binding, field mapping, and refresh interval controls move into the unified edit mode form; no longer a standalone Data tab.

## Impact

- `frontend/src/components/PanelDetailModal.*` — primary change; tab layout replaced with unified edit form
- `frontend/src/components/` — any customization popover component(s) removed
- `frontend/src/store/panelsSlice.*` — no structural changes; existing PATCH thunks remain
- No backend changes required — all existing endpoints already support the data being surfaced

## Non-goals

- No new backend endpoints or schema changes
- No change to how data is fetched or persisted; only the UI surface changes
- No change to the panel grid layout or panel types

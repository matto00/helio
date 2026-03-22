## Why

The panel `type` field was added to the data model in HEL-22 but the create flow still always defaults to `metric` — users have no way to choose a type at creation time. Surfacing the selector now completes the create-flow half of the panel type system before per-type rendering is built.

## What Changes

- The inline panel create form in `PanelList` gains a type selector (segment control or select) with the four options: `metric`, `chart`, `text`, `table`
- `metric` is pre-selected as the default
- The selected type is forwarded through the Redux `createPanel` thunk to `POST /api/panels`
- The create form layout is adjusted to accommodate the new control without visual clutter

## Capabilities

### New Capabilities

- `panel-type-selector`: UI control in the panel create form that lets users pick a panel type before submitting; selection is passed to the backend on create

### Modified Capabilities

- `frontend-panel-creation`: The create form now includes a type selector; the "User creates a panel" scenario changes to include type selection

## Impact

- `frontend/src/components/PanelList.tsx` — inline create form updated
- `frontend/src/components/PanelList.css` — layout styles for the selector
- `frontend/src/features/panels/panelsSlice.ts` — no change needed (already accepts optional `type`)
- `frontend/src/services/panelService.ts` — no change needed (already accepts optional `type`)
- No backend changes required

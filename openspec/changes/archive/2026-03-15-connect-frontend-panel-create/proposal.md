## Why

`HEL-10` closes the next frontend/backend gap after dashboard creation: users still cannot create panels through the real API from the selected dashboard context. Without this, panel lifecycle behavior remains partially scaffolded and cannot be exercised end-to-end from the UI.

## What Changes

- Add a frontend `createPanel` service call wired to `POST /api/panels`.
- Add a Redux async create flow for panels.
- Add inline panel creation controls in the panel list header:
  - a `+` icon button to open create mode
  - an inline text field for panel title
  - a `Create panel` confirmation button
- After successful create, refresh panels for the selected dashboard and keep create logic separate from presentation concerns.

## Capabilities

### New Capabilities
- `frontend-panel-creation`: Users can create panels through the selected dashboard context using the backend API.

### Modified Capabilities
- `frontend-dashboard-selection-flow`: Panel creation continues to respect selected-dashboard context and selection-driven loading behavior.

## Impact

- `frontend/src/components/PanelList.tsx`
- `frontend/src/components/PanelList.css`
- `frontend/src/features/panels/**`
- `frontend/src/services/panelService.ts`
- `frontend/src/components/PanelList.test.tsx`
- `frontend/src/features/panels/panelsSlice.test.ts`

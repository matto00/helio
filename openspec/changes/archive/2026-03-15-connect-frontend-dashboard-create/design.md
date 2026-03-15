## Context

The backend already supports `POST /api/dashboards`, but the frontend does not expose create behavior. Dashboard list interactions are already centralized in `DashboardList`, while dashboard state and selection are managed by the dashboards Redux slice. `HEL-9` should add create flow in that same path to keep behavior modular and predictable.

## Goals / Non-Goals

**Goals:**
- Enable dashboard creation from the frontend via backend API.
- Keep create UX lightweight and inline in the dashboard list.
- Select the created dashboard automatically after success.
- Keep state updates performant by using the create response directly.
- Keep validation and error handling simple and explicit.

**Non-Goals:**
- Dashboard creation modal workflows.
- Advanced field validation or naming rules beyond existing backend normalization.
- Bulk dashboard creation.
- Backend API contract changes for dashboard creation.

## Decisions

### Place creation controls in `DashboardList`
Creation starts from a `+` icon button in the dashboard list header and expands to an inline text field with a `Create dashboard` action.

Alternative considered:
- Placing create controls in the global app header was rejected because dashboard list operations (view/select/create) should stay co-located.

### Add a dedicated `createDashboard` thunk in dashboards slice
Dashboard creation will use a dedicated async thunk that calls a new dashboard service method and returns the created dashboard.

Alternative considered:
- Reusing fetch + local dispatch wiring from component code was rejected to preserve centralized async behavior and testability in the slice.

### Update state from create response instead of full re-fetch
On success, append the created dashboard to `state.items` and set `selectedDashboardId` to the new dashboard id.

Alternative considered:
- Re-fetching all dashboards after create was rejected for now because it adds network latency and extra load for a known payload we already received.

### Keep inline create failure messaging local
Failed creation attempts display a local inline error state and do not reset existing dashboard selection.

Alternative considered:
- Global toast/system notification handling was rejected because shared feedback components are out of scope for `HEL-9`.

## Risks / Trade-offs

- [Inline form can crowd the dashboard list header] -> Keep controls compact and only render field/button while create mode is active.
- [Backend name normalization can differ from frontend input] -> Trust backend response and render the returned dashboard object.
- [Duplicate submit clicks] -> Disable submit while request is in flight.

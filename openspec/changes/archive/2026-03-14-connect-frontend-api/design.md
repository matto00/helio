## Context

The frontend currently renders from local starter Redux state and has no transport layer for backend reads. The backend now exposes read routes for dashboards and dashboard-scoped panels, so this ticket needs to add a reusable frontend API boundary and async Redux state flow without locking in future dashboard-selection UI details. Because panel loading should remain lazy, the design should separate dashboard reads from panel reads and avoid coupling panel requests to initial app bootstrap.

## Goals / Non-Goals

**Goals:**
- Add typed axios-based service modules for dashboard and panel reads.
- Add `createAsyncThunk`-based Redux read flows for dashboards and panels.
- Replace the current starter local assumptions with backend-backed state.
- Keep panel loading lazy rather than fetching all panels at app startup.
- Add simple loading and error fallback UI that can later be replaced with richer components.

**Non-Goals:**
- Dashboard selection UI design.
- Create/update/delete frontend flows.
- Advanced caching, retries, or optimistic updates.
- Full visual design for loading or error states.

## Decisions

### Use axios in small typed service modules
Frontend API access will live in small reusable service functions so transport concerns remain separate from Redux slices and UI components.

Alternative considered:
- Plain `fetch` was rejected because the ticket explicitly prefers `axios` and typed service modules will make future expansion easier.

### Use `createAsyncThunk` inside feature slices
Dashboard and panel reads will be represented as async thunk actions managed by Redux slices, keeping loading/error state close to the domain data they belong to.

Alternative considered:
- Service calls directly from components were rejected because they scatter async state and make reuse harder.

### Replace starter local data with backend-backed state
The frontend will no longer rely on hardcoded starter entities once the read flow is connected. The state source of truth becomes the backend read response.

Alternative considered:
- Keeping a silent local fallback was rejected because it can hide integration failures and weaken confidence in the real data flow.

### Keep panel fetching lazy and selection-ready
Dashboards will load first. Panel fetching will remain a separate action that can be triggered when a dashboard selection exists, rather than being tightly coupled to app bootstrap.

Alternative considered:
- Eagerly fetching panels for a guessed dashboard at startup was rejected because the user explicitly wants lazy reads and a future selection component.

### Use simple built-in fallback UI states
The current app shell and list components can render minimal loading/error states for now, which keeps the flow functional without prematurely designing richer status components.

Alternative considered:
- Waiting for a future UI spec before showing any error/loading state was rejected because the ticket explicitly wants simple fallback behavior now.

## Risks / Trade-offs

- [Async state shape may need future reshaping] → Keep service modules and thunk boundaries small so selection and richer UI can evolve later.
- [Backend ordering does not yet encode “most recent” selection] → Keep lazy panel fetching selection-driven and avoid hardcoding a long-term selection policy in this ticket.
- [Transport and UI concerns could drift together] → Keep axios services, thunk logic, and presentational rendering in separate modules.

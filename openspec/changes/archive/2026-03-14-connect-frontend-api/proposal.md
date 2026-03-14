## Why

The frontend still renders from local starter state, so it is not yet exercising the backend API or the real dashboard/panel data flow. Connecting the frontend to backend reads now creates the first reusable transport boundary and moves the app toward actual dashboard behavior without overcommitting to future UI details.

## What Changes

- Add typed frontend service modules for dashboard and panel read endpoints using `axios`.
- Add Redux async read flows using `createAsyncThunk` for dashboard and panel fetching.
- Replace the current hardcoded starter dashboard and panel assumptions with backend-backed state.
- Lazy-fetch panels instead of loading them eagerly.
- Add simple default loading and error UI for the dashboard and panel read flow.
- Keep the integration modular so future create/update behavior can reuse the same service and async state structure.

## Capabilities

### New Capabilities
- `frontend-api-services`: Provide typed frontend service modules for dashboard and panel reads against the backend HTTP API.
- `frontend-backend-read-flow`: Load dashboard and panel state from backend-backed async Redux flows with simple loading and error fallbacks.

### Modified Capabilities

## Impact

- `frontend/package.json`
- `frontend/src/app`
- `frontend/src/store`
- `frontend/src/features/**`
- `frontend/src/components/**`
- new frontend service/type modules
- frontend async state and backend integration behavior

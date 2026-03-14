## 1. Frontend transport setup

- [x] 1.1 Add `axios` to the frontend and create typed service modules for dashboard and panel reads
- [x] 1.2 Add frontend API/domain types needed for backend-backed dashboard and panel data

## 2. Async Redux read flows

- [x] 2.1 Refactor the dashboard slice to use backend-backed async loading with `createAsyncThunk`
- [x] 2.2 Refactor the panel slice to use lazy backend-backed async loading with `createAsyncThunk`
- [x] 2.3 Update store wiring so async dashboard and panel state remains modular and reusable

## 3. UI integration

- [x] 3.1 Update the app flow to trigger dashboard loading from the backend
- [x] 3.2 Update the dashboard and panel list components to render backend-backed data with simple loading/error fallback states

## 4. Verification

- [x] 4.1 Add or update frontend tests for the async read flow and fallback UI behavior
- [x] 4.2 Run frontend tests, repo lint, format check, and frontend build to confirm the integration is non-breaking

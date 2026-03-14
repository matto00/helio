## 1. Shared resource metadata

- [x] 1.1 Add a shared `meta` model for dashboards and panels in the backend domain and API response layer
- [x] 1.2 Update dashboard and panel JSON Schemas to require `meta.createdBy`, `meta.createdAt`, and `meta.lastUpdated`
- [x] 1.3 Update frontend types and any related service assumptions to consume the shared metadata shape

## 2. Dashboard selection flow

- [x] 2.1 Update dashboard selection logic to default to the dashboard with the newest `meta.lastUpdated`
- [x] 2.2 Add a clickable dashboard list on the left side of the app shell
- [x] 2.3 Keep panel loading lazy and selection-driven through the existing Redux + service structure

## 3. Verification

- [x] 3.1 Add or update backend tests for metadata-backed dashboard and panel responses
- [x] 3.2 Add or update frontend tests for default selection, clickable dashboard changes, and lazy panel loading behavior
- [x] 3.3 Run backend tests, frontend tests, repo lint, format check, and frontend build to verify the change is non-breaking

## 1. Resource appearance contracts

- [x] 1.1 Add nested `appearance` models for dashboards and panels in backend domain and API contracts
- [x] 1.2 Update JSON Schemas to require/validate dashboard and panel appearance objects
- [x] 1.3 Add backend read/write behavior and tests for persisted in-memory appearance settings

## 2. Frontend appearance state and editing

- [x] 2.1 Add frontend types and service/state support for dashboard and panel appearance settings
- [x] 2.2 Add dashboard appearance controls for dashboard background customization
- [x] 2.3 Add panel appearance controls for panel background, color, and transparency customization
- [x] 2.4 Apply saved appearance settings to the dashboard shell and panel grid without breaking the existing theme system

## 3. Verification

- [x] 3.1 Add or update backend tests for appearance-backed dashboard and panel responses/updates
- [x] 3.2 Add or update frontend tests for appearance editing, persistence flow, and rendered visual application
- [x] 3.3 Run backend tests, frontend tests, repo lint, format check, and frontend build to verify the customization flow is non-breaking

## 1. Frontend dashboard create contract

- [x] 1.1 Add a `createDashboard` frontend service function for `POST /api/dashboards`
- [x] 1.2 Add a dashboards slice async thunk for dashboard creation
- [x] 1.3 On successful create, insert the created dashboard into state and set it as selected

## 2. Dashboard list inline create UX

- [x] 2.1 Add a `+` icon button to enter create mode in the dashboard list header
- [x] 2.2 Add an inline dashboard-name text input and `Create dashboard` submit button
- [x] 2.3 Show explicit inline loading/error feedback and prevent duplicate submits

## 3. Verification

- [x] 3.1 Add or update slice tests for successful and failed create behavior
- [x] 3.2 Add or update component tests for inline create interaction and active selection behavior
- [x] 3.3 Run frontend lint, format check, tests, and build

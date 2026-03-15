## 1. Dashboard layout contract

- [x] 1.1 Add dashboard-owned responsive layout models in backend domain and API contracts
- [x] 1.2 Update JSON Schemas to validate dashboard layout objects and layout items
- [x] 1.3 Seed demo dashboards with representative saved layout data

## 2. Backend persistence flows

- [x] 2.1 Add backend update behavior for saving dashboard layout state
- [x] 2.2 Return saved layout state in dashboard responses
- [x] 2.3 Add backend tests for layout reads, updates, and invalid/missing resource behavior

## 3. Frontend layout persistence

- [x] 3.1 Extend frontend types, services, and state to load and save dashboard layout data
- [x] 3.2 Update the panel grid to hydrate from saved dashboard layout state
- [x] 3.3 Persist drag and resize changes back to the backend on completed layout updates
- [x] 3.4 Merge saved layouts safely with generated fallback placements for new or missing panels

## 4. Verification

- [x] 4.1 Add or update frontend tests for layout hydration and persistence
- [x] 4.2 Verify layout changes survive dashboard switching and reloads
- [x] 4.3 Run backend tests, frontend tests, lint, format check, and frontend build

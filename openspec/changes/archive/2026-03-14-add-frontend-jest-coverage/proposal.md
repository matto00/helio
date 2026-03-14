## Why

The frontend scaffold currently has no Jest coverage, which leaves the starter Redux state and presentational components unprotected as the UI begins to evolve. Adding tests now creates a stable baseline for future dashboard and panel work without forcing behavior checks to be reconstructed later.

## What Changes

- Add Jest coverage for the dashboard and panel Redux slices.
- Add colocated component tests for the starter dashboard and panel list components.
- Verify default render behavior and empty-state behavior through `@testing-library/react`.
- Add the minimal frontend test dependencies and configuration needed to run React component tests reliably in the Vite/TypeScript frontend module.
- Keep tests behavior-focused and easy to extend as the frontend grows.

## Capabilities

### New Capabilities
- `frontend-slice-test-coverage`: Cover the starter dashboard and panel slices with behavior-focused Jest tests.
- `frontend-component-test-coverage`: Cover the starter dashboard and panel list components with colocated `@testing-library/react` tests for current render behavior.

### Modified Capabilities

## Impact

- `frontend/package.json`
- `frontend/src/features/**`
- `frontend/src/components/**`
- frontend Jest/test environment configuration
- frontend test execution behavior

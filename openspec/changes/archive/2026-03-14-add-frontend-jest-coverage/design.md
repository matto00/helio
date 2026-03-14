## Context

The frontend module currently has a small React + TypeScript + Redux scaffold with no test coverage. The ticket asks for slice tests and starter component tests, and those component tests need a React-capable Jest environment instead of the current placeholder-only configuration. Because the frontend is still small, the design should add only the minimum dependencies and setup needed to support maintainable, colocated tests.

## Goals / Non-Goals

**Goals:**
- Add colocated Jest tests for the dashboard and panel slices.
- Add colocated `@testing-library/react` tests for `DashboardList` and `PanelList`.
- Configure the frontend test environment so React component tests run cleanly.
- Keep tests behavior-focused and easy to extend as the frontend grows.

**Non-Goals:**
- End-to-end browser tests.
- Snapshot-heavy testing.
- Full frontend architecture changes or state management refactors.
- Coverage thresholds or CI policy changes.

## Decisions

### Use `@testing-library/react` for component behavior
Starter components are simple renderers over Redux state, so Testing Library gives the best fit for asserting visible behavior without coupling tests to implementation details.

Alternative considered:
- Renderer-level or shallow-style tests were rejected because they are less aligned with the ticket goal of behavior-focused component coverage.

### Colocate tests with slices and components
Tests will live next to the source files they cover. This keeps the small frontend scaffold easy to navigate and helps new tests grow with each feature module.

Alternative considered:
- A separate `frontend/tests` folder was rejected because it adds indirection without a large enough test surface to justify it.

### Add a frontend-specific Jest DOM environment
The frontend needs `jsdom` and Jest DOM assertions for component tests. The root Jest config can remain in place, but frontend tests will require the right dependencies and setup files so React rendering works reliably.

Alternative considered:
- Avoiding component tests and testing only reducers was rejected because the ticket explicitly includes starter component render behavior.

## Risks / Trade-offs

- [Frontend Jest setup drifts from actual runtime assumptions] → Keep setup minimal and limited to DOM rendering support.
- [Tests become too tied to implementation] → Assert rendered text and state behavior rather than internals.
- [Colocated tests add noise to source directories] → Keep naming consistent and scope tests only to meaningful behavior.

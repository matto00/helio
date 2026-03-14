## Why

The backend currently exposes only read endpoints for dashboards and panels, which blocks any end-to-end creation flow from being added to the application. We need write endpoints now so the API can support the first real dashboard and panel creation workflows while staying aligned with explicit JSON contracts.

## What Changes

- Add a `POST /api/dashboards` endpoint that accepts a dashboard create request and returns the created dashboard with `201 Created`.
- Add a `POST /api/panels` endpoint that accepts a panel create request and returns the created panel with `201 Created`.
- Add request contract models for dashboard and panel creation payloads.
- Validate request bodies so missing required fields return `400 Bad Request`.
- Normalize blank or missing dashboard names and panel titles to a server-side default value.
- Reject panel creation for non-existent dashboards with `404 Not Found`.
- Extend backend route tests to cover success and invalid input paths.

## Capabilities

### New Capabilities
- `dashboard-write-api`: Create dashboards through the backend API using a contract-defined request payload and normalized server-side defaults.
- `panel-write-api`: Create panels through the backend API using a contract-defined request payload with dashboard existence validation.

### Modified Capabilities

## Impact

- `backend/src/main/scala/com/helio/api`
- `backend/src/main/scala/com/helio/app`
- `backend/src/test/scala/com/helio/api`
- `schemas/`
- Akka HTTP request/response handling
- In-memory actor workflows for dashboard and panel creation

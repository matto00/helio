## Why

Helio needs a `GET /health` endpoint so Cloud Run startup and liveness probes can
verify the backend is running without requiring authentication. Without it, Cloud Run
cannot confirm the service is healthy at deploy time.

## What Changes

- Add `GET /health` route to Akka HTTP (`ApiRoutes.scala`) returning `200 OK` with a
  JSON body `{"status": "ok"}`
- Route is unauthenticated — no auth middleware applied
- Route is defined so a DB ping (`SELECT 1`) can be added later without breaking the
  interface

## Capabilities

### New Capabilities

- `health-endpoint`: Unauthenticated HTTP health check endpoint for infrastructure
  probes and uptime monitoring

### Modified Capabilities

<!-- None — no existing spec-level behavior changes -->

## Impact

- **Backend**: New route in `ApiRoutes.scala`; new `HealthRoutes.scala` (or inline)
- **API contract**: `GET /health` added to the documented endpoints
- **Infrastructure**: Cloud Run startup probes can now reference `/health`
- **Frontend**: No changes required

## Non-goals

- DB ping / deep health check (deferred to a future ticket)
- Authentication or rate-limiting on this endpoint
- Frontend changes

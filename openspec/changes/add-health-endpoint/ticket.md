# HEL-119 — Add /health endpoint on backend

## Description

Add a `GET /health` route to Akka HTTP routes that returns 200 OK. Later, extend to include a DB ping (`SELECT 1`). Keep the basic version unauthenticated so Cloud Run startup probes can hit it.

## Acceptance Criteria

- `GET /health` returns HTTP 200 OK
- The endpoint is unauthenticated (no auth middleware applied)
- The response body is a simple JSON object (e.g. `{"status": "ok"}`)
- The route is registered in `ApiRoutes.scala`
- Cloud Run startup probes can use this endpoint without credentials
- Future extension point: DB ping (`SELECT 1`) can be added later without breaking the interface

## Notes

- This is a backend-only change
- The endpoint already appears in the API Contract section of CLAUDE.md as `GET /health` — this ticket implements it
- Priority: High (blocks deployment/infra work)

## Context

The Helio backend requires a `GET /health` endpoint for Cloud Run startup and liveness probes.
The route must be unauthenticated and return `200 OK` with a JSON body.

The existing codebase already has the scaffolding in place:
- `HealthRoutes.scala` — defines `GET /health` returning `HealthResponse(status = "ok")`
- `ApiRoutes.scala` — instantiates `HealthRoutes` and registers it outside the `/api` prefix
- `JsonProtocols.scala` — defines `HealthResponse(status: String)` and its JSON formatter
- `ApiRoutesSpec.scala` — includes a test asserting `GET /health` returns `200 OK` + `HealthResponse("ok")`

The implementation is complete. This change's task is to verify it, ensure the Scala
backend compiles and tests pass, and formalise the spec.

## Goals / Non-Goals

**Goals:**
- Confirm `GET /health` returns `200 OK` with `{"status":"ok"}` (backend test green)
- Confirm route is registered at the top level (outside auth middleware)
- Formalise the `health-endpoint` capability in OpenSpec

**Non-Goals:**
- DB ping / deep health check (deferred)
- Frontend changes
- Rate limiting or authentication on this endpoint

## Decisions

**No new files needed** — all Scala files are already present. The task for the executor
is to run `sbt test` in the backend and confirm the health test passes. If any compilation
or test failures exist, they should be fixed.

**Route placement** — `health.routes` is concatenated before the `pathPrefix("api")` block
in `ApiRoutes.scala`, so it is unauthenticated by design. This matches Cloud Run probe
requirements.

**Response shape** — `{"status":"ok"}` is sufficient for a shallow health check. The
`HealthResponse` case class is easily extended with a `db` field later.

## Risks / Trade-offs

- No DB check means the endpoint will return 200 even if the DB is down. Acceptable for
  now; a deep health check is explicitly out of scope.

## Planner Notes

Implementation already exists in the worktree from prior work. The executor should run
`sbt test` to confirm the green state, then commit. No code additions are expected unless
a compilation error is found.

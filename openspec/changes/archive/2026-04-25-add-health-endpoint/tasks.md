## 1. Backend

- [x] 1.1 Verify `HealthRoutes.scala` exists and implements `GET /health` returning `HealthResponse(status = "ok")`
- [x] 1.2 Verify `HealthResponse` case class and JSON formatter are present in `JsonProtocols.scala`
- [x] 1.3 Verify `ApiRoutes.scala` registers `health.routes` outside the `/api` prefix (unauthenticated)

## 2. Tests

- [x] 2.1 Run `sbt test` in `backend/` and confirm the health endpoint test passes
- [x] 2.2 Confirm the test asserts `GET /health` returns `200 OK` and `HealthResponse("ok")`

## 3. Commit

- [x] 3.1 Stage and commit all changes with message `HEL-119 Add GET /health endpoint`

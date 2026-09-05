## Why

`DELETE /api/data-sources/:id` returns a bare **500** when the source being deleted is a
pipeline's **sole root**. Reproduced deterministically against production three times (HEL-987),
and reproduced locally by direct probe against the dev Postgres.

The 500 is a server fault reachable from ordinary operation, and it is permanently unretryable:
any client treating 500 as transient — as the helio-news MCP cleanup pass did — retries a request
that can never succeed. The correct contract already exists elsewhere in the codebase
(`WorkspaceTeardownRepository.sourceDependentPipelineConflict` computes a structured conflict for
tag-scoped teardown); it was simply never applied to the single-resource delete path.

## What Changes

- `DataSourceService.delete` SHALL detect, **before** issuing the delete, that the source is the
  sole root of one or more pipelines, and return a structured conflict instead of attempting a
  delete that the database will reject.
- The route maps that conflict to **409** with a body naming the blocking resource
  (`resourceKind` / `resourceId` / `resourceName` / `reason`), consistent with the existing
  `TeardownConflict` shape.
- The underlying database error is defensively mapped as well, so that even if the pre-check and
  the delete race, the caller still receives a 409 rather than a 500.
- The underlying cause is logged server-side at WARN; the client-facing body stays non-leaky (no
  SQLSTATE, no driver text, no raised trigger message).
- **Not** a breaking change: a source that is one of *several* roots keeps today's behavior
  (delete succeeds). Broadening the 409 to any referencing pipeline was considered and explicitly
  rejected — see design.md Decision 1 and HEL-989.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `datasource-edit-delete`: adds a backend requirement that `DELETE /api/data-sources/:id` returns
  a structured 409 (not a 500) when the delete would leave a pipeline with zero roots. The
  existing frontend delete-warning requirements are unchanged.

## Impact

- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — pre-check + error mapping in `delete`.
- `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` — 409 rendering for the new conflict error.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` — sole-root dependent query.
- API behavior: one status code changes, 500 -> 409, on a path that is currently always a hard failure. No currently-succeeding request changes behavior.
- **No database migration.** The fix is service/route-layer only, so it does not touch
  `flyway_schema_history` — deliberately compatible with the concurrent HEL-983 / HEL-985 runs
  sharing this dev Postgres.

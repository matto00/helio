## Context

The current API has 11 distinct write paths for a single dashboard session, each making a separate HTTP request.
Layout PATCHes (`PATCH /api/dashboards/:id`) are the most frequent call type. The `DashboardRepository.update`
method already uses Slick's `transactionally` combinator (visible in `duplicate` and `importSnapshot`), so a
transactional multi-operation path is a natural extension of existing patterns.

The `DashboardRoutes.scala` routes handler and `DashboardRepository.scala` are the primary extension points.
`ApiRoutes.scala` wires sub-routers into the composition; a new route case can be added to
`DashboardRoutes` without touching the top-level router.

No new database tables are required for this ticket's four operation types — all fields already exist in
`dashboards` and `panels` tables. The `userPreference` operation type (zoom level) is a domain concept but
has no backing table yet; this ticket defers its storage to a future migration and returns a `todo` status
for that operation type so the schema is extensible without blocking delivery.

## Goals / Non-Goals

**Goals:**
- Single `POST /api/dashboards/:id/batch` route that applies multiple typed operations in one DB transaction
- Versioned operation schema (`op` discriminator + `v` version field) for future extensibility
- Response includes updated panel list to eliminate the follow-up GET after panel create/duplicate
- Frontend layout save path migrates from `PATCH /api/dashboards/:id` to the batch endpoint
- OpenAPI spec updated with batch path, operation union type, and response shape
- Backend tests: happy path, partial-failure rollback, unknown operation type

**Non-Goals:**
- Migrating panel/dashboard create or duplicate calls to the batch endpoint
- Client-side batching queue or coalescing logic
- `userPreference` persistence (schema defined, backend returns `todo` acknowledgement)
- Rate limiting or payload size caps

## Decisions

**Operation discriminator field**: Use `"op"` (string enum) as the discriminator on each operation object.
Each operation carries `"v": 1` for versioning. Alternatives: integer opcode (less readable) or type-tagged
union via JSON Schema `oneOf` (more complex, chosen for spec but not opcode numeric).

**Response shape**: Return `{ dashboard, panels }` — same shape as `DuplicateDashboardResponse` which already
exists in `JsonProtocols.scala`. Re-using this case class avoids redundant types. The response always returns
the full updated dashboard and the current panel list for the targeted dashboard.

**Transaction scope**: Wrap all operations in a single `DBIO.seq(...).transactionally` action using Slick.
On any failure the entire batch is rolled back. This matches the pattern in `DashboardRepository.duplicate`.

**Unknown operation handling**: Return `400 Bad Request` with an `ErrorResponse` for any unknown `op` value.
This is consistent with existing validation patterns in `DashboardRoutes` and `RequestValidation`.

**Route placement**: Add a new `path(Segment / "batch")` case within the existing `DashboardRoutes` `pathPrefix("dashboards")` block. This keeps all dashboard-scoped routes co-located. The route is authenticated (inside `authDirectives.authenticate`).

**Frontend migration scope**: Only the layout persistence thunk (`saveDashboardLayout` / the debounced
`PATCH` in `PanelGrid.tsx`) migrates to the batch endpoint in this ticket. Other write paths remain on
their existing endpoints to minimize surface area.

**Schema files**: Add `batch-request.schema.json` and `batch-response.schema.json` to `schemas/` directory,
following the existing naming convention alongside `dashboard.schema.json` etc.

## Risks / Trade-offs

**Payload size growth**: A batch containing a full layout (4 × N items) plus several panel appearance updates
is larger than any single current request. Mitigation: the debounce already coalesces layout updates; the
batch replaces one PATCH with one POST of similar size.

**Partial knowledge of `userPreference`**: zoom level has no backing table yet. Mitigation: the backend
accepts and validates the operation shape but returns `{ op: "userPreference", status: "todo" }` in the
result array, logging the intent. This keeps the schema forward-compatible without a blocking migration.

**Slick transaction scope across two tables**: Updating `dashboards` and `panels` rows in one transaction
is already done in `DashboardRepository.importSnapshot`. That pattern is safe with HikariCP. Risk: low.

## Migration Plan

1. Add Scala domain models and `JsonProtocols` entries (no DB migration needed for core operations)
2. Add `batchUpdate` method to `DashboardRepository` using `.transactionally`
3. Add `POST /api/dashboards/:id/batch` route to `DashboardRoutes`
4. Add JSON Schema files to `schemas/`
5. Update OpenAPI spec
6. Update `dashboardService.ts` with `batchUpdate` function
7. Update `dashboardsSlice.ts` to wire layout thunk to batch endpoint
8. Update `PanelGrid.tsx` debounce call target
9. Add backend tests

Rollback: the old `PATCH /api/dashboards/:id` layout path is not removed; frontend can revert to it by
changing the thunk call site.

## Planner Notes

Self-approved. This is a backend extension + frontend migration with no breaking changes to existing
endpoints and no new external dependencies. Existing PATCH layout path is preserved for rollback safety.

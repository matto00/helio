## 1. Backend: protocol + schema

- [x] 1.1 Add `WorkspaceContextProtocol.scala` under `api/protocols/` with response case classes:
      `WorkspaceContextResponse`, `WorkspaceContextCounts`, `WorkspaceContextDataSource`,
      `WorkspaceContextDataType`, `WorkspaceContextColumn`, `WorkspaceContextComputedColumn`,
      `WorkspaceContextPipeline`, `WorkspaceContextPipelineStep`, `WorkspaceContextDashboard`
      (field-for-field per design.md D4/D7, no `pipelineShapes` field)
- [x] 1.2 Add spray-json formatters for the new protocol types to `JsonProtocols.scala` (never inline
      fully-qualified names — import at top per CONTRIBUTING.md)
- [x] 1.3 Add `schemas/workspace-context.schema.json` (JSON Schema 2020-12) mirroring the protocol shape;
      description notes structural parity with `helio-mcp/src/context.ts` `WorkspaceContext` and the
      intentional `pipelineShapes` omission (design.md D4)

## 2. Backend: service

- [x] 2.1 Create `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` taking
      `DashboardService`, `DataSourceService`, `DataTypeRepository`, `PipelineService` as constructor args
      (design.md D1)
- [x] 2.2 Implement `assemble(user: AuthenticatedUser): Future[WorkspaceContextResponse]` — fetch
      dashboards/dataSources/dataTypes via `Page.Default` (design.md D3), pipelines via `listSummaries`
- [x] 2.3 Implement `dataTypes[].pipelineOutput = sourceId.isEmpty` classification directly off the domain
      `DataType.sourceId: Option[DataSourceId]` (design.md D7 — no wire round-trip)
- [x] 2.4 Implement per-pipeline `analyze` fan-out via `Future.sequence`/`Future.traverse`, each wrapped so
      an individual failure yields `steps = Vector.empty` + `stepsError = Some(message)` instead of failing
      the whole assembly (design.md D5)
- [x] 2.5 Populate `counts` from each list call's `PagedResult.total` (dashboards/dataSources/dataTypes) and
      `pipelines.size` — not from the (possibly page-truncated) `items.length`

## 3. Backend: route wiring

- [x] 3.1 Add `context` sub-route to `backend/src/main/scala/com/helio/api/routes/WorkspaceRoutes.scala`:
      `GET /api/workspace/context` calling `workspaceContextService.assemble(user)`
- [x] 3.2 Update `WorkspaceRoutes`'s constructor to take `WorkspaceContextService` alongside the existing
      `WorkspaceTeardownService`
- [x] 3.3 Wire `WorkspaceContextService` unconditionally in `ApiRoutes.scala` (no `Option`-guard — design.md
      D2) and pass it into the existing `WorkspaceRoutes(...)` construction site (~line 354)

## 4. Tests

- [x] 4.1 `WorkspaceContextServiceSpec`: empty workspace returns all-zero counts and empty collections
- [x] 4.2 `WorkspaceContextServiceSpec`: owner-scoping — user B never sees user A's sources/types/pipelines/
      dashboards, and `counts` reflects only the caller's own totals
- [x] 4.3 `WorkspaceContextServiceSpec`: `pipelineOutput` is `true` for a pipeline-output DataType
      (`sourceId` absent) and `false` for a source-companion DataType (`sourceId` present)
- [x] 4.4 `WorkspaceContextServiceSpec`: pipeline `steps[].outputColumns` reflects the analyzed per-step
      output schema, in step order
- [x] 4.5 `WorkspaceContextServiceSpec`: one pipeline's analyze failure degrades to `steps: []` +
      `stepsError`, without failing the rest of the assembly
- [x] 4.6 `WorkspaceRoutesSpec` (or extend existing workspace route test): `GET /api/workspace/context`
      returns `200` with a schema-valid body for an authenticated session
- [x] 4.7 `AuthDirectivesSpec` or `WorkspaceRoutesSpec`: a scoped PAT calling `GET /api/workspace/context`
      receives `403 Forbidden` (design.md D6)
- [x] 4.8 Run `sbt test` and confirm the full suite is green

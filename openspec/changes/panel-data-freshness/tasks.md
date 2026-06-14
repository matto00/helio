## 1. Backend

- [x] 1.1 Add `findLastRunAtByOutputDataTypeId(id: DataTypeId): Future[Option[Instant]]` to `PipelineRepository` using `withSystemContext` and `MAX(last_run_at) WHERE last_run_status = 'succeeded'` query
- [x] 1.2 Add `dataAsOf: Option[String]` field to `PanelResponse` case class in `PanelProtocol.scala`
- [x] 1.3 Update `PanelResponse.fromDomain` to accept `dataAsOf: Option[String]` parameter and include it in the response
- [x] 1.4 Update `panelResponseFormat` in `PanelProtocol` from `jsonFormat8` to `jsonFormat9` to include `dataAsOf`
- [x] 1.5 Update `schemas/panel.schema.json` to add `"dataAsOf": { "type": ["string", "null"] }` to `properties` (not to `required` — it is additive)
- [x] 1.6 Inject `PipelineRepository` into `PublicDashboardRoutes` (the class that handles `GET /api/dashboards/:id/panels`) via `ApiRoutes.scala` constructor wiring
- [x] 1.7 In `PublicDashboardRoutes`, for each panel call `panel.dataTypeId` (the abstract method on the `Panel` sealed trait — returns `Option[DataTypeId]`); for panels where it returns `Some(id)`, look up `dataAsOf` via `findLastRunAtByOutputDataTypeId(id)` concurrently (`Future.sequence`)
- [x] 1.8 Update all other `PanelResponse.fromDomain` call sites (`PanelRoutes.scala` — batch, create, patch, duplicate; `DashboardRoutes.scala` — duplicate) to pass `dataAsOf = None`

## 2. Frontend

- [x] 2.1 Add `dataAsOf?: string | null` to the `PanelBase` interface in `frontend/src/features/panels/types/panel.ts`
- [x] 2.2 Add freshness indicator to `PanelCard.tsx` in the title area — render `"Data as of <formatRelativeTime(dataAsOf)>"` below the `<h3>` title when `dataAsOf` is non-null and non-empty
- [x] 2.3 Import `formatRelativeTime` into `PanelCard.tsx`
- [x] 2.4 Add CSS for the freshness indicator element (muted, small, below title) in the panel card stylesheet

## 3. Tests

- [x] 3.1 Add backend test to `ApiRoutesSpec` or `PipelineRepositorySpec`: `findLastRunAtByOutputDataTypeId` returns correct timestamp for a pipeline with a run
- [x] 3.2 Add backend test: `GET /api/dashboards/:id/panels` response includes `dataAsOf` ISO string for a bound panel whose pipeline has run
- [x] 3.3 Add backend test: `GET /api/dashboards/:id/panels` response includes `dataAsOf: null` for an unbound panel
- [x] 3.4 Add frontend test to `PanelCard` or `PanelGrid` test file: renders freshness indicator when `dataAsOf` is set
- [x] 3.5 Add frontend test: hides freshness indicator when `dataAsOf` is null

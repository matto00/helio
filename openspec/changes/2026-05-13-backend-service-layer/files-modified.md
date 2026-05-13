# Files modified — backend-service-layer (CS2b)

## New files — services/ package

- `backend/src/main/scala/com/helio/services/ServiceError.scala` — HTTP-agnostic error ADT (BadRequest / Unauthorized / NotFound / Forbidden / Conflict / BadGateway / InternalError) used by all services
- `backend/src/main/scala/com/helio/services/AccessChecker.scala` — trait defining the ACL surface for services (`requireOwnerOnly`, `requireAccess`)
- `backend/src/main/scala/com/helio/services/DashboardService.scala` — CRUD + duplicate + snapshot export/import + 4 snapshot validators
- `backend/src/main/scala/com/helio/services/PanelService.scala` — CRUD + duplicate + batch update + patch resolver
- `backend/src/main/scala/com/helio/services/PanelPatchApplier.scala` — the title→appearance→type→content→binding→image→divider apply chain (extracted to keep `PanelService` inside the 300-line budget)
- `backend/src/main/scala/com/helio/services/AuthService.scala` — register / login / logout / completeOAuth + CSRF state store + session minting
- `backend/src/main/scala/com/helio/services/DataSourceService.scala` — CSV + Static CRUD, refresh, preview, infer
- `backend/src/main/scala/com/helio/services/SourceService.scala` — REST + SQL CRUD, refresh, preview, infer
- `backend/src/main/scala/com/helio/services/DataTypeService.scala` — CRUD + computed-field validation + listRows
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — pipeline + step CRUD + analyze
- `backend/src/main/scala/com/helio/services/PermissionService.scala` — list / grant / revoke
- `backend/src/main/scala/com/helio/services/SourceConfigParsing.scala` — spray-json formats for `SqlSourceConfigPayload` + `RestApiConfigPayload` so services can parse stored `data_sources.config` without importing Pekko HTTP
- `backend/src/main/scala/com/helio/services/DataSourceCsvSupport.scala` — moved from `api/routes/` (now only used by services)

## New files — api/ (HTTP layer)

- `backend/src/main/scala/com/helio/api/AccessCheckerImpl.scala` — concrete `AccessChecker` backed by `ResourceTypeRegistry` + `ResourcePermissionRepository`; reuses the same logic the `AclDirective` runs at the HTTP layer
- `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala` — `run` / `runNoContent` helpers map `ServiceError` → HTTP status + `ErrorResponse(message)` body

## Modified — api/

- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — constructs all services and threads them into the (now-thin) route classes
- `backend/src/main/scala/com/helio/api/routes/DashboardRoutes.scala` — 222 → 76 lines; thin HTTP shell
- `backend/src/main/scala/com/helio/api/routes/DashboardSnapshotRoutes.scala` — 109 → 47 lines; thin HTTP shell
- `backend/src/main/scala/com/helio/api/routes/PanelRoutes.scala` — 214 → 81 lines; thin HTTP shell
- `backend/src/main/scala/com/helio/api/routes/PublicDashboardRoutes.scala` — 60 → 47 lines; delegates `resolvePanels` to `PanelService.resolveBindingsForRead` (CS2a spinoff closed)
- `backend/src/main/scala/com/helio/api/routes/AuthRoutes.scala` — 153 → 51 lines; thin HTTP shell
- `backend/src/main/scala/com/helio/api/routes/OAuthRoutes.scala` — 149 → 148 lines; keeps HTTP-heavy `exchangeCodeForTokenImpl` / `fetchGoogleProfileImpl` because tests override them, but delegates user upsert + session mint to `AuthService.completeOAuth`
- `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala` — 229 → 105 lines; thin HTTP shell, multipart unmarshalling stays here
- `backend/src/main/scala/com/helio/api/routes/DataSourcePreviewRoutes.scala` — 201 → 78 lines; thin HTTP shell
- `backend/src/main/scala/com/helio/api/routes/SourceRoutes.scala` — 182 → 57 lines; thin HTTP shell
- `backend/src/main/scala/com/helio/api/routes/SourcePreviewRoutes.scala` — 248 → 68 lines; thin HTTP shell
- `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala` — 162 → 66 lines; thin HTTP shell
- `backend/src/main/scala/com/helio/api/routes/PipelineRoutes.scala` — 223 → 59 lines; thin HTTP shell
- `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala` — 114 → 49 lines; thin HTTP shell
- `backend/src/main/scala/com/helio/api/routes/PermissionRoutes.scala` — 82 → 50 lines; thin HTTP shell

## Deleted

- `backend/src/main/scala/com/helio/api/routes/PanelPatchService.scala` — absorbed into `PanelService` + `PanelPatchApplier`
- `backend/src/main/scala/com/helio/api/routes/AuthSupport.scala` — absorbed into `AuthService` companion

## Tests

- `backend/src/test/scala/com/helio/services/DashboardSnapshotValidationSpec.scala` — moved from `api/routes/` to mirror the new home of `validateSnapshotPayload`
- `backend/src/test/scala/com/helio/api/GoogleOAuthRoutesSpec.scala` — constructs `AuthService` to pass into `OAuthRoutes`; behaviour assertions unchanged
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` — constructs `PipelineService` for the route
- `backend/src/test/scala/com/helio/api/routes/DataTypeRoutesSpec.scala` — constructs `DataTypeService` + `AccessCheckerImpl`
- `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala` — constructs `PipelineService`

## OpenSpec

- `openspec/changes/2026-05-13-backend-service-layer/tasks.md` — checkboxes ticked + notes on the few deltas from the original plan (no `PasswordHasher` extraction, no `SessionCookie` since pre-CS2b uses bearer tokens not cookies, `OAuthRoutes` at 148 lines because the test-override protected hooks must stay on the class)

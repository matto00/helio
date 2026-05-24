# Backend protocols split — Change Set 1 of HEL-236

## Why

`backend/src/main/scala/com/helio/api/JsonProtocols.scala` has grown to **832 lines** and bundles every request/response case class, every companion-object converter, and every implicit Spray JSON format across all domains (Dashboard, Panel, DataSource, DataType, Pipeline, Pipeline-run, Auth, Permission, Snapshot, REST connector, SQL connector, Static connector). It is the canonical example of the god-file pattern HEL-236 was raised to eliminate.

Two concrete pains drive splitting now:

1. **Cross-domain coupling at compile time.** Any touch to a single response type rebuilds the entire trait — and tests run formatters via implicit search across the whole trait, so a stray ambiguity in one domain breaks unrelated tests.
2. **Convention drift.** Some route methods consume raw `String` IDs and rely on the repository to wrap them (`PanelId(...)`); others wrap at the route boundary. The repository sometimes ends up doing both. A single boundary policy is cheaper than the current case-by-case judgment.

This change set is the smallest, lowest-risk piece of the four-PR HEL-236 plan, so it ships first and locks in conventions the later change sets rely on.

## What changes

### File split

`JsonProtocols.scala` is decomposed into a per-domain package `com.helio.api.protocols`:

| New file | Owns |
|---|---|
| `ResourceProtocol.scala` | `ResourceMetaResponse`, `ErrorResponse`, `HealthResponse` (and shared root formats) |
| `AuthProtocol.scala` | `RegisterRequest`, `LoginRequest`, `UserPreferences`, `UserResponse`, `AuthResponse`, `GoogleProfile`, `UpdateUserPreferenceRequest`, `UserPreferencePayload` |
| `DashboardProtocol.scala` | `DashboardAppearancePayload/Response`, `DashboardLayout*`, `DashboardResponse`, `DashboardsResponse`, `DuplicateDashboardResponse`, `CreateDashboardRequest`, `UpdateDashboardRequest`, `UpdateDashboardBatchRequest`, `DashboardSnapshot*` |
| `PanelProtocol.scala` | `PanelAppearancePayload/Response`, `PanelResponse`, `PanelsResponse`, `CreatePanelRequest`, `UpdatePanelRequest` (with the custom `Option[Option[_]]` formatter), `PanelBatchItem`, `UpdatePanelsBatchRequest/Response`, `PanelQuery` formatter, chart-appearance sub-types |
| `DataTypeProtocol.scala` | `DataFieldResponse/Payload`, `ComputedFieldResponse/Payload`, `DataTypeResponse`, `DataTypesResponse`, `UpdateDataTypeRequest`, `ValidateExpressionResponse`, `InferredField*`, `SchemaFieldResponse`, `DataTypeRowsResponse` |
| `DataSourceProtocol.scala` | `DataSourceResponse`, `DataSourcesResponse`, `CreateDataSourceRequest`, `UpdateDataSourceRequest`, `CsvPreviewResponse`, `PreviewSourceResponse`, REST connector types, SQL connector types, static connector types, `CreateSourceResponse` |
| `PipelineProtocol.scala` | `CreatePipelineRequest`, `UpdatePipelineRequest`, `PipelineSummaryResponse`, `CreatePipelineStepRequest`, `UpdatePipelineStepRequest`, `PipelineStepResponse`, `AnalyzeStepResponse`, `PipelineAnalyzeResponse`, `RunSubmitResponse`, `RunStatusResponse`, `PipelineRunRecord`, `RunResultResponse` |
| `PermissionProtocol.scala` | `GrantPermissionRequest`, `PermissionResponse`, `PermissionsResponse` |

Each file:
- Owns its case classes, companion-object converters, and `implicit` Spray JSON formats.
- Exposes a `trait XxxProtocol extends SprayJsonSupport with DefaultJsonProtocol` containing only that domain's formats.

`JsonProtocols.scala` becomes a **70-line aggregator** that mixes in every per-domain trait, so all existing call sites (`extends JsonProtocols`) continue to work unchanged. No route file or test needs a new import.

### ID-wrapper boundary policy

Codify in `com.helio.api.protocols.IdParsing` (or as a `RequestValidation` extension) that:

- **All routes wrap path-extracted IDs into value classes at the route boundary**, never inside repositories or services. The boundary is the `pathPrefix("dashboards" / DashboardIdSegment)` directive (or its equivalent), not the repository method signature.
- Repositories accept value-class IDs only. Any internal `String` parameter is a code smell.
- The pattern is documented in a short docstring on `protocols/IdParsing.scala` and demonstrated in two route files (`DashboardRoutes`, `PanelRoutes`) that currently pass raw strings.

We will **survey but not exhaustively rewrite** route signatures in this change set — the policy is documented and the obvious offenders fixed; the rest are inventoried for CS2 cleanup.

### Schema-drift checker update

`scripts/check-schema-drift.mjs` currently reads only `JsonProtocols.scala`. It must be updated to glob `backend/src/main/scala/com/helio/api/protocols/*.scala` and aggregate parsed case classes across all of them.

## Impact

- **Specs affected:** none — this is a structural refactor with no behavior change.
- **Affected code:**
  - **Added:** 8 files under `backend/src/main/scala/com/helio/api/protocols/`
  - **Modified:** `JsonProtocols.scala` (shrunk to aggregator), `scripts/check-schema-drift.mjs` (multi-file glob)
  - **Touched:** 2 route files (`DashboardRoutes.scala`, `PanelRoutes.scala`) for ID-wrapper boundary demonstration
- **Frontend:** untouched.
- **Test impact:** zero tests should need changes; all 495 backend tests must remain green.
- **Public API:** no change. JSON wire shapes are byte-identical.

## Out of scope

- Reshaping any route logic, repository, or domain model (CS2).
- Frontend touchups (CS3 / CS4).
- Adding new endpoints or fields.
- Renaming case classes (would be a wire-shape change).
- Splitting `model.scala`.

## Acceptance criteria

- [ ] `sbt test` passes (495 tests).
- [ ] `npm run check:schemas` passes against the new layout.
- [ ] `npm run lint`, `npm run format:check`, frontend `npm test` all pass (touched only by the schema script).
- [ ] No file in `backend/src/main/scala/com/helio/api/protocols/` exceeds 250 lines.
- [ ] `JsonProtocols.scala` is ≤ 80 lines and contains zero `implicit val ...Format = ...` definitions of its own.
- [ ] `DashboardRoutes.scala` and `PanelRoutes.scala` extract path-IDs into value-class wrappers at the route boundary.
- [ ] `git diff main -- '*.scala'` is movement only — no new domain logic, no behavioral edits.
- [ ] Manual sanity: backend starts, `curl /health` returns 200, one panel patch + one dashboard patch + one pipeline run via the smoke flow continue to work.

## Risk

- **Implicit collision:** moving formats into multiple traits could create ambiguous implicits if a domain accidentally re-defines a format that another trait already provides. Mitigation: per-domain traits own their formats exclusively; aggregator `JsonProtocols` is the only place that combines them.
- **Schema checker breakage:** if the multi-file glob misses a file, drift goes undetected. Mitigation: the existing `SKIP` allowlist still applies; the script's "fail loudly on new unmapped class" behavior surfaces omissions.
- **Companion-object placement:** the existing file has companion `object` blocks (e.g., `PanelResponse.fromDomain`) outside the trait. These move *with* their case class to the new per-domain file.

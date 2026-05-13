# Files Modified — CS2a backend routes decompose

## Modified

- `backend/src/main/scala/com/helio/api/AclDirective.scala` — Group D: narrow `extends JsonProtocols` → `extends ResourceProtocol`.
- `backend/src/main/scala/com/helio/api/AuthDirectives.scala` — Group D: narrow `extends JsonProtocols` → `extends ResourceProtocol`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wire up four new sibling route classes (`DashboardSnapshotRoutes`, `SourcePreviewRoutes`, `DataSourcePreviewRoutes`, `OAuthRoutes`).
- `backend/src/main/scala/com/helio/api/routes/AuthRoutes.scala` — Group E: split Google OAuth handlers into `OAuthRoutes`; trimmed to credential flows; shared helpers via `AuthSupport`.
- `backend/src/main/scala/com/helio/api/routes/DashboardRoutes.scala` — Group B: extracted `applyDashboardUpdate` (dedup PATCH); moved snapshot import/export + `validateSnapshotPayload` to `DashboardSnapshotRoutes`; removed dead `resolvePanels`.
- `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala` — Group A: `DataSourceIdSegment` rollout; Group E: split preview/refresh/infer to `DataSourcePreviewRoutes`; extract `createStatic` / `createCsv` / `insertCsvSource` helpers.
- `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala` — Group A: `DataTypeIdSegment` rollout at three call sites.
- `backend/src/main/scala/com/helio/api/routes/PanelRoutes.scala` — Group C: flatten 8-level PATCH nesting via `Either`-chain → `PanelPatchService`. Now 214 lines.
- `backend/src/main/scala/com/helio/api/routes/PermissionRoutes.scala` — Group A: `UserIdSegment` for granteeId.
- `backend/src/main/scala/com/helio/api/routes/PipelineRoutes.scala` — Group A: `PipelineIdSegment` rollout; removed unused `DataSourceId` import.
- `backend/src/main/scala/com/helio/api/routes/PipelineRunRoutes.scala` — Group A survey: wrap path-extracted pipelineId in `PipelineIdSegment` (`pid` shadow used at call sites since repos still take `String`).
- `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala` — Group A survey: same wrap pattern as `PipelineRunRoutes`.
- `backend/src/main/scala/com/helio/api/routes/SourceRoutes.scala` — Group A: `DataSourceIdSegment` rollout; Group E: split preview/refresh/infer to `SourcePreviewRoutes`. Now 182 lines.
- `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala` — Group D: narrow `extends JsonProtocols` → `extends DashboardProtocol with PanelProtocol`; switched protocol imports.
- `backend/src/main/scala/com/helio/infrastructure/DataTypeRepository.scala` — Group D: narrow to `extends DataTypeProtocol`.
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — Group D: narrow to `extends PanelProtocol`; pulled `PanelBatchItem` from `com.helio.api.protocols`.
- `backend/src/test/scala/com/helio/api/GoogleOAuthRoutesSpec.scala` — point test fixtures at the new `OAuthRoutes` class.

## Added

- `backend/src/main/scala/com/helio/api/routes/AuthSupport.scala` — shared token / session / CSRF helpers used by both `AuthRoutes` and `OAuthRoutes`.
- `backend/src/main/scala/com/helio/api/routes/DashboardSnapshotRoutes.scala` — `/dashboards/:id/export` + `/dashboards/import`; companion-object snapshot validators (`for`-comprehension idiom).
- `backend/src/main/scala/com/helio/api/routes/DataSourceCsvSupport.scala` — small utility: `decodeUtf8` + `csvPathFromConfig`, shared between `DataSourceRoutes` and `DataSourcePreviewRoutes`.
- `backend/src/main/scala/com/helio/api/routes/DataSourcePreviewRoutes.scala` — `/refresh`, `/preview`, `/infer` for `/api/data-sources`.
- `backend/src/main/scala/com/helio/api/routes/OAuthRoutes.scala` — Google OAuth kickoff + callback (was inline in `AuthRoutes`).
- `backend/src/main/scala/com/helio/api/routes/PanelPatchService.scala` — `ResolvedPanelPatch` case class + `resolvePatch` validator + `applyPanelPatch` repo-fan-out + `resolvePanels` cross-user binding scrub.
- `backend/src/main/scala/com/helio/api/routes/SourcePreviewRoutes.scala` — `/refresh`, `/preview`, `/infer` for `/api/sources`; includes shared `upsertDataType` helper.
- `backend/src/test/scala/com/helio/api/routes/DashboardSnapshotValidationSpec.scala` — five-case unit spec covering version, name, panel-type, layout-reference rejection paths + a happy-path round-trip.

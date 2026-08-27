# Files modified — HEL-826

## Backend (main)

- `backend/src/main/scala/com/helio/domain/model/model.scala` — added `bodyContentType`/`rootSelector` to `RestApiConfig` and `EphemeralRestConfig`; added `RestApiConfig.rejectBodyOnSafeMethod`/`RestApiConfig.parseBodyContentType` (task 1.1/1.2/1.3).
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — added `bodyContentType`/`rootSelector` to `RestApiConfigPayload`, threaded through `toDomain`/`fromDomain` (decode-is-total: no new validation added here), widened `jsonFormat9` → `jsonFormat11` (task 2.1).
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceConfigCodec.scala` — widened its own `RestApiConfigPayload` spray-json format (`jsonFormat9` → `jsonFormat11`) to keep compiling against the new fields (task 2.1/2.4).
- `backend/src/main/scala/com/helio/services/sources/SourceService.scala` — belt-and-braces `rejectBodyOnSafeMethod` calls at both `createRest` branches (task 2.3); forwards `body`/`bodyContentType`/`rootSelector` in the bare-url synthesized `RestApiConfig` (Decision 5); `toEphemeral` now returns `Either[String, EphemeralRestConfig]` with the same belt-and-braces guard, callers (`inferRest`/`testRest`) updated (task 2.3b); `previewRest` passes `source.config.rootSelector` into `toRows` (task 4.1).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — inline `rest_api` dry-analyze bare-url branch forwards `body`/`bodyContentType`/`rootSelector` into the synthesized `EphemeralRestConfig` (task 2.3c).
- `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala` — `resolveTemplatedRequestParts` resolves `body` via `TemplateInterpolator.resolveJsonBody` (task 3.1); `buildResolvedRequest` calls the two structural guards first, then attaches `HttpEntity` when a body is present (task 3.2); `buildEphemeralRequest` now returns `Either[String, HttpRequest]` with the identical guards, no templating (task 3.3), callers (`fetchEphemeral`, `testConnectionEphemeral`) updated; `toRows` gains `rootSelector: Option[String] = None` implementing the dot-path walk + zero-rows-on-miss (task 4.1); `fetch`/`inferSchema`/`inferSchemaEphemeral` thread `config.rootSelector` through their `toRows` calls.

## Backend (test)

- `backend/src/test/scala/com/helio/domain/model/RestApiConfigSpec.scala` (new) — unit coverage for `rejectBodyOnSafeMethod`/`parseBodyContentType` (task 1.3).
- `backend/src/test/scala/com/helio/api/protocols/sources/RestApiConfigPayloadToDomainSpec.scala` (new) — decode-is-total permissiveness + pre-existing-validation regression coverage for `toDomain` (task 2.2).
- `backend/src/test/scala/com/helio/services/sources/SourceServiceSpec.scala` — added GET+body immediate-400 coverage for both `createRest` dual-support branches (task 2.3).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineServiceInlineRestBodySpec.scala` (new) — inline pipeline-proposal `rest_api` bare-url source forwards body/bodyContentType/rootSelector correctly (task 2.3c).
- `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverBodySpec.scala` (new) — `buildResolvedRequest`/`buildEphemeralRequest` structural guards (task 3.2/3.3), real-echo-server body wiring + hostile-template escaping (task 3.4), credential-unreachability-from-body coverage (task 3.5).
- `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverSpec.scala` — added `toRows(json, rootSelector)` coverage: unset-byte-identical, nested single/two-level selector, missing-path zero-rows, non-object mid-walk zero-rows (task 4.2).

## Frontend

- `frontend/src/features/sources/services/dataSourceService.ts` — `RestApiConfigBody` gains `body`/`bodyContentType`; `jsonPath` renamed to `rootSelector` (wire field) (task 5.1).
- `frontend/src/features/sources/ui/forms/RestApiForm.tsx` — adds a method `<select>` (GET/POST/PUT/PATCH) replacing the hardcoded `"GET"`; adds a body textarea + content-type field, rendered only for POST/PUT/PATCH; `buildConfig()` sends `rootSelector` (task 5.2a/5.2b).
- `frontend/src/features/sources/ui/AddSourceModal.tsx` — adds `method`/`body`/`bodyContentType` state; both config-building call sites (`handlePreview`, `handleCreate`) use the selected method and forward body/bodyContentType/rootSelector; wires the new `RestApiForm` props (task 5.2a/5.2b).

## Not modified (deliberately)

- No Flyway migration — `body`/`bodyContentType`/`rootSelector` are new, additive `Option` fields on a JSONB-backed config (design.md Migration Plan).

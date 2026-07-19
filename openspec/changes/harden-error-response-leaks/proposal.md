## Why

`OAuthRoutes.scala:134` returns `ex.getMessage` in the client-facing error body when the OAuth
code exchange fails — leaking internal exception text (stack details, upstream URLs, JDBC/Postgres
internals) to an unauthenticated caller, the same class HEL-299 fixed in `PipelineRunStreamRoutes`.
The design gate established the class is architectural, not local: the CS2b `ServiceResponse`
bridge turns any `ServiceError.*` message built in `services/` straight into a client body, and
several `domain/` connectors embed raw `ex.getMessage`/JDBC text into strings that bubble up. The
human chose a full sweep (Option C) over the ticket-literal route-only fix.

## What Changes

- Fix the confirmed route-layer `500` leaks: `OAuthRoutes.scala:134`, `ApiRoutes.scala:161,193`
  (add loggers, log full exception + stack trace, return generic `"Internal server error"`).
- Sweep the `services/` layer: every `ServiceError.*` constructed with a raw exception message
  (`getMessage`/`getLocalizedMessage`, or raw PSQLException/JDBC text) that reaches a client via
  `ServiceResponse.completeError` is fixed — log detail server-side, return a client-safe message.
  Confirmed sites: `PipelineService.classifyDbError` (413–421), `PanelService:219,254`,
  `PipelineRunService:146`, `SourceService` `BadGateway` arms.
- Sweep reachable `domain/` connectors whose error strings surface to clients: `SqlConnector:88`,
  `RestApiConnector:56,62`, `ContentSourceSupport:133,234`, `PdfTextSupport:44`,
  `PanelConfigCodec:91,92`, `PipelineAnalyzeService`, `InProcessPipelineEngine:151`.
- Classify the `4xx` route arms (`SourcePreviewRoutes`, `DataSourceRoutes`, `SourceRoutes`) —
  fix if they carry raw internal detail, else confirm-safe with rationale.
- Audit note (`audit.md`) listing every file/line with before/after message and decision.
- Tests: OAuth `500` path, an `ApiRoutes` `500` path, and a service-layer DB-failure path — each
  asserting a generic client body and server-side logging of the detail.

## Capabilities

### New Capabilities

- `error-response-safety`: cross-cutting invariant — no HTTP error response body includes raw
  exception text or internal/infrastructure detail; such detail is logged server-side.

### Modified Capabilities

- `google-oauth-login`: the OAuth callback's unexpected-failure path returns a generic `500` body
  and logs the exception detail, rather than echoing the raw exception message.

## Impact

- Code: `routes/OAuthRoutes`, `api/ApiRoutes`, `services/{PipelineService,PanelService,SourceService,
  PipelineRunService,DataSourceService}`, `domain/{SqlConnector,RestApiConnector,
  ContentSourceSupport,PdfTextSupport,PipelineAnalyzeService,InProcessPipelineEngine}`,
  `domain/panels/PanelConfigCodec`; audit of the three `4xx` route files.
- Wire: error-body **text** changes on failure paths; status codes and `ErrorResponse` shape
  unchanged. No frontend, migration, or dependency impact.

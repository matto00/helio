## Context

Two mechanisms carry exception detail to client bodies in this codebase:

1. **Direct route completion.** `OAuthRoutes.scala:134`, `ApiRoutes.scala:161,193` call
   `complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))` inline. Neither file
   has a logger. Same class HEL-299 fixed in `PipelineRunStreamRoutes` (logger + `log.error(msg, ex)`
   + `ErrorResponse("Internal server error")`).
2. **The CS2b `ServiceResponse` bridge.** `ServiceResponse.completeError`
   (`backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala`) maps every `ServiceError`
   variant to `complete(<status>, ErrorResponse(message))`. So any `ServiceError.*(msg)` built in
   `services/` — or any `domain/` error string that a service wraps into one — reaches the client
   verbatim. Route files like `PanelRoutes`/`PipelineStepRoutes` have no literal leak; it lives one
   or two hops upstream.

Enumerated candidate surface (from an unscoped `getMessage`/`getLocalizedMessage` grep across
`services/` + `domain/`, plus `PSQLException` handling):

- **services/**: `PipelineService.classifyDbError` (413–421; `case other`→`500`, PSQLException→
  `404`/`400`/`500` with raw text), `PipelineService:237,318` (`Invalid config: ${ex.getMessage}`),
  `PanelService:219` (`BadRequest(ex.getMessage)` on `batchUpdate` DB failure), `PanelService:254`
  (`IllegalArgumentException` patch validation), `PipelineRunService:147` (`previewStep`) **and
  `:250`** (run-execution `errMsg` — one string fanning out to three client surfaces: SSE
  `errorLog` via `PipelineRunRegistry.toSseBytes`→`PipelineRunStreamRoutes`; `RunStatusResponse.error`
  via `PipelineRunStatusRoutes`; persisted `PipelineRunRecord.errorLog` via
  `PipelineRunService.history()`→`PipelineRunHistoryRoutes`), `SourceService:189,205,235,248`
  (`BadGateway` wrapping connector err).
- **domain/ + service-support files**: `SqlConnector:88`, `RestApiConnector:56,62`,
  `ContentSourceSupport:133,234` (under `services/`), `PdfTextSupport:44` (under `services/`),
  `PanelConfigCodec:91,92`, `InProcessPipelineEngine:151`,
  `PipelineAnalyzeService:129,181,212,246,262` — each embeds `ex.getMessage` into an error string.
- **routes/ (4xx, already scoped)**: `SourcePreviewRoutes` (2), `DataSourceRoutes` (4),
  `SourceRoutes` (2) — `Try(json.convertTo[...])` deserialization arms.

## Goals / Non-Goals

**Goals:**
- No HTTP error body contains raw exception text or internal/infra detail; the detail is logged
  server-side (full exception + stack trace via the `Throwable` log overload).
- Preserve *useful, curated, non-sensitive* client feedback (e.g. "Pipeline not found", size-limit
  messages, size/shape validation) — only the raw `ex.getMessage`/JDBC portions are genericized.
- One audit note (`audit.md`) enumerating every file/line with before/after and decision.

**Non-Goals:**
- Reworking `ServiceError`/`ServiceResponse` types or the `ErrorResponse` wire shape.
- Changing status codes (only body text on failure paths changes).
- Frontend, migrations, new dependencies.

## Decisions

- **Classification rule (applied per site, reachability-traced to a route):**
  - *FIX* — any site where a raw `ex.getMessage`/`getLocalizedMessage` or raw PSQLException/JDBC
    text can reach a client body. Log the exception server-side (`log.error(<context>, ex)`), and
    return a generic, curated client message (e.g. "Internal server error", "Database error",
    "Request to the data source failed"). Preserve any *static* descriptive prefix.
  - *CONFIRM-SAFE* — sites whose message is a static/curated string with no raw exception text
    (e.g. `NotFound(s"Pipeline not found: ${id.value}")`, `PayloadTooLarge(...)` limits). Recorded
    in the audit note, unchanged.
- **Logging.** Add an slf4j `LoggerFactory` logger to each file that gains a FIX and lacks one
  (`OAuthRoutes`, `ApiRoutes`, `PipelineService`/companion, `PanelService`, connectors as needed),
  mirroring `PipelineRunStreamRoutes`. `logback-classic` is already a compile dep (build.sbt:90).
- **Domain connectors.** Where a connector builds `s"... ${e.getMessage}"` that a service surfaces
  to the client (`SqlConnector`, `RestApiConnector`, `ContentSourceSupport`, `PdfTextSupport`),
  log the cause at the connector/service boundary and return a generic client string; keep the
  static category prefix ("SQL execution failed", "Request failed") since it is not sensitive.
- **`PipelineAnalyzeService` / analyze warnings.** These `... config error: ${ex.getMessage}`
  strings surface in the analyze response. Genericize the raw `ex.getMessage` tail (log detail),
  keep the "<op> config error" category so the UI still signals which step is misconfigured.
- **Alternative rejected:** a single shared "sanitize on the way out" wrapper in `ServiceResponse`.
  It cannot distinguish curated vs. raw messages after the fact and would flatten useful `4xx`
  feedback; per-site classification is the correct granularity.

## Risks / Trade-offs

- [Over-genericizing degrades a genuinely useful validation message] → Only the raw exception tail
  is removed; static/curated prefixes and IDs stay. Each decision is recorded in `audit.md`.
- [A missed reachable site leaves residual leak] → The audit is grep-complete over `services/` +
  `domain/` and the final gate re-greps; every hit is listed with a decision, not silently skipped.
- [Test reaching a service DB-failure path without a real DB] → use an injected failing repo/stub
  (existing service specs already stub repositories) + logback `ListAppender` for the log assertion.

## Planner Notes

- Self-approved scope is now **Option C (full sweep)** per explicit human direction at the design
  gate (rounds 1–2 REFUTE expanded route→service→domain). Recorded on the ticket.
- Spec: adds a new cross-cutting capability `error-response-safety` for the invariant, plus the
  `google-oauth-login` delta for the concrete OAuth arm.

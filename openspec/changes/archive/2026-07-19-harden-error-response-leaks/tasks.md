## 1. Backend — route-layer 500 leaks

- [x] 1.1 Add slf4j `LoggerFactory` loggers to `OAuthRoutes` and `ApiRoutes` (neither has one; match `PipelineRunStreamRoutes`)
- [x] 1.2 `OAuthRoutes.completeOAuthExchange`: replace catch-all `Failure(ex)` `ErrorResponse(ex.getMessage)` with `log.error(<msg>, ex)` + `ErrorResponse("Internal server error")`; leave the `502` upstream arm
- [x] 1.3 `ApiRoutes.scala:161` (`GET /api/auth/me`) and `:193` (`PATCH /api/users/me/update`): same fix for each `Failure(ex)` `500` arm

## 2. Backend — services-layer sweep (via ServiceResponse bridge)

- [x] 2.1 `PipelineService.classifyDbError` (413–421): log the exception; return generic messages — `case other`→`InternalError("Internal server error")`, PSQLException branches keep their `NotFound`/`BadRequest`/`InternalError` status but drop raw Postgres text; add a `PipelineService` logger
- [x] 2.2 `PipelineService:237,318` (`Invalid '<type>' config: ${ex.getMessage}`): keep the `Invalid '<type>' config` prefix, log the decode exception, drop the raw `ex.getMessage` tail
- [x] 2.3 `PanelService:219` (`BadRequest(ex.getMessage)` on `batchUpdate` DB failure): log + generic client message; add a `PanelService` logger
- [x] 2.4 `PanelService:254` (`IllegalArgumentException` patch validation): classify — if the message is curated validation text keep it (audit note), else genericize + log
- [x] 2.5 `PipelineRunService`: genericize BOTH `"Pipeline execution failed: " + ex.getMessage` occurrences — line 147 (`previewStep`, `UnprocessableEntity`) and line 250 (run-execution `errMsg`). Keep the static prefix, log the cause, drop the raw tail. The line-250 `errMsg` is one string that fans out to three client surfaces, so fixing it at construction covers all three; verify each consumer: (a) SSE `errorLog` via `PipelineRunRegistry.toSseBytes` → `PipelineRunStreamRoutes` (`GET /api/pipelines/:id/runs/events`), (b) `RunStatusResponse.error` via `PipelineRunStatusRoutes` (`GET /api/pipelines/:id/runs/:runId`), (c) persisted `PipelineRunRecord.errorLog` via `PipelineRunService.history()` → `PipelineRunHistoryRoutes` (`GET /api/pipelines/:id/runs`)
- [x] 2.6 `SourceService` `BadGateway` arms (189,205,235,248) that surface connector `err` strings: ensure the client string is generic once connectors (§3) are fixed; classify each in the audit note

## 3. Backend — domain-layer sweep (error strings reachable via services)

- [x] 3.1 `SqlConnector:88`, `RestApiConnector:56,62`, `ContentSourceSupport:133,234`, `PdfTextSupport:44`: log the cause at the boundary; keep the static category prefix, drop the raw `${e.getMessage}` tail
- [x] 3.2 `PanelConfigCodec:91,92`: classify — genericize raw `ex.getMessage`/`DeserializationException` tail reaching client config-validation bodies (log detail)
- [x] 3.3 `PipelineAnalyzeService:129,181,212,246,262`: keep the `<op> config error` category, drop the raw `${ex.getMessage}` tail (log detail); `InProcessPipelineEngine:151`: same treatment if reachable to a client body, else audit as safe

## 4. Backend — 4xx route arms (classify)

- [x] 4.1 Inspect `SourcePreviewRoutes` (2), `DataSourceRoutes` (4), `SourceRoutes` (2); fix any arm carrying raw internal detail, else confirm-safe with rationale

## 5. Audit note

- [x] 5.1 Write `openspec/changes/harden-error-response-leaks/audit.md` listing every file/line audited (routes + services + domain) with before/after message text and FIX/CONFIRM-SAFE decision; end with a re-grep confirming no residual raw-exception-in-body site remains

## 6. Tests

- [x] 6.1 OAuth callback catch-all (via `exchangeCodeForTokenImpl`/`fetchGoogleProfileImpl` hooks): assert `500` body is generic, no raw exception text, and detail is logged (logback `ListAppender`)
- [x] 6.2 An `ApiRoutes` `500` arm (e.g. `GET /api/auth/me` failure): assert generic body, no raw exception text
- [x] 6.3 A service-layer DB-failure path (e.g. `PipelineService.addStep`/`classifyDbError` or `PanelService.batchUpdate` with a failing stubbed repo): assert generic client message and server-side logging
- [x] 6.4 A pipeline run-execution failure (stubbed engine failure): assert the `error`/`errorLog` surfaced by `GET /api/pipelines/:id/runs/:runId` (`RunStatusResponse.error`, simplest to test without SSE) contains no raw exception text and the detail is logged server-side. **Deviation** (see audit.md's `SparkJobSubmitter` note): the `PipelineRunCache` backing this exact route is currently populated only by `SparkJobSubmitter`, which is unwired to any live route (pre-HEL-202) — the route itself always 404s today regardless of this fix. Tested the two *reachable* fan-out surfaces instead (SSE `errorLog` via a new failure-path test, and persisted `PipelineRunRecord.errorLog` via run-history), and additionally fixed + tested `SparkJobSubmitter`'s identical leak directly against the cache/repo layer so surface (b) is safe once HEL-202 wires it in.

## 7. Verification

- [x] 7.1 `sbt test` green; `openspec validate harden-error-response-leaks --strict` passes

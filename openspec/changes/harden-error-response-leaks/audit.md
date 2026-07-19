# HEL-311 audit — error-response exception-leak sweep

Scope: Option C (full sweep), per the design gate. Every site found by
`grep -rn "getMessage\|getLocalizedMessage" backend/src/main/scala/com/helio/`
plus a `PSQLException` review, traced to whether it can reach an HTTP
response body. Each site below is classified **FIX** (raw exception text
removed, detail logged server-side, generic/curated message returned) or
**CONFIRM-SAFE** (no raw exception text reaches the client; rationale given).

## Route layer (§1)

### `api/routes/OAuthRoutes.scala:134` — FIX

- Before: `complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))`
  on the catch-all `Failure(ex)` arm of `completeOAuthExchange`.
- After: added an slf4j `LoggerFactory` logger (file had none); `log.error(<msg>, ex)`
  then `ErrorResponse("Internal server error")`. The `502` upstream-error arm
  (`isUpstreamOAuthError`) is unchanged — it already returns a static message.
- Note: `OAuthRoutes.scala:160` (`isUpstreamOAuthError`'s `Option(ex.getMessage)`)
  is CONFIRM-SAFE — used only to pattern-match the exception's own message for
  classification; never included in a response body.

### `api/ApiRoutes.scala:161` (`GET /api/auth/me`) — FIX

- Before: `complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))`.
- After: added a class-level logger; `log.error(s"GET /api/auth/me failed for user ${...}", ex)`
  then `ErrorResponse("Internal server error")`.

### `api/ApiRoutes.scala:193` (`PATCH /api/users/me/update`) — FIX

- Same pattern as above: `log.error(...)` + generic `"Internal server error"` body.

## Services layer — via the `ServiceResponse` bridge (§2)

### `services/PipelineService.classifyDbError` (companion object) — FIX

- Before: `PSQLException` branches returned `ServiceError.NotFound(msg)` /
  `ServiceError.BadRequest(msg)` / `ServiceError.InternalError(msg)` with the
  raw Postgres message (`msg`, which can include table/column/constraint
  names); the `case other` arm returned `ServiceError.InternalError(other.getMessage)`.
- After: added a companion-object logger; every branch now logs the full
  exception (`log.error("Pipeline step DB operation failed", e)`) and returns
  a generic message per category — `"Referenced resource not found"` (FK
  violation → `NotFound`), `"Request violates a data constraint"` (check
  violation → `BadRequest`), `"Internal server error"` (all other DB errors,
  including the `case other` non-PSQL arm → `InternalError`). Status codes
  unchanged.

### `services/PipelineService.scala` — `addStep` config decode (`Invalid '<type>' config: ${ex.getMessage}`) — FIX

- Before: raw `PipelineStepConfigCodec.decode` failure message appended to
  the client body.
- After: kept the curated `"Invalid '<type>' config"` prefix, dropped the raw
  tail, added `log.warn(..., ex)` before returning.

### `services/PipelineService.scala` — `updateStep` config decode (same pattern) — FIX

- Same fix as `addStep`, mirrored for the update path.

### `services/PipelineService.scala:210` (`toAnalyzeStepResponse`, `Failure(ex)` arm) — CONFIRM-SAFE (unchanged)

- This throws `IllegalStateException` with `ex.getMessage` embedded, but it is
  an invariant-violation guard (a persisted step's config should always
  decode) that is never caught by a `.recover`/`ServiceError` mapping — it
  propagates as an uncaught exception through the `Future`. Verified against
  Pekko HTTP's `ExceptionHandler.default` (`pekko-http_2.13-1.1.0` sources):
  the `NonFatal(e)` branch logs the exception+message server-side via
  `ctx.log.error(e, ...)` and completes with a **bare** `InternalServerError`
  (no body, no `ex.getMessage`). Not reachable to a client body. Same
  reasoning applies to `infrastructure/PipelineStepRepository.scala:221`
  (identical shape, one layer down) — also CONFIRM-SAFE, unchanged.

### `services/PanelService.scala:219` area (`batchUpdate` DB-failure `.recover`) — FIX

- Before: `.recover { case ex => Left(ServiceError.BadRequest(ex.getMessage)) }`.
- After: added a class-level logger; `log.error(s"batchUpdate failed for dashboard ${...}", ex)`
  then `Left(ServiceError.BadRequest("Batch update failed"))`.

### `services/PanelService.scala:262` (`update`'s `IllegalArgumentException` `.recover`) — CONFIRM-SAFE (unchanged, fixed at source)

- This wraps `PanelConfigCodec.applyConfigPatch`'s `Left(err)` string into
  `IllegalArgumentException(err)`. Traced `err`'s origin to
  `domain/panels/PanelConfigCodec.safe` (see below): after that fix, `err` is
  always either a curated `DeserializationException` message (authored via
  `deserializationError(...)` throughout `domain/panels/*`, never a wrapped
  raw exception) or the static string `"config decode failed"`. Since the
  source is now guaranteed safe, `ex.getMessage` here is safe by
  construction — left unchanged, with a comment added at the codec explaining
  the invariant.

### `services/PipelineRunService.scala` — `previewStep`, `"Pipeline execution failed: " + ex.getMessage` — FIX

- Before: raw exception tail appended after the `UnprocessableEntity` status.
- After: kept the `"Pipeline execution failed"` prefix, dropped the raw tail,
  `log.error(s"previewStep failed for pipeline ..., step ...", ex)`.

### `services/PipelineRunService.scala` — `executeRun`'s run-failure `errMsg` (fans out to 3 surfaces) — FIX

- Before: `val errMsg = "Pipeline execution failed: " + Option(ex.getMessage).getOrElse(ex.getClass.getName)`,
  used to build (a) the SSE `errorLog` event (`PipelineRunStreamRoutes` via
  `PipelineRunRegistry`), (b) the eventual `RunStatusResponse.error`
  (`PipelineRunStatusRoutes`, when the run's cache entry carries an error —
  see the `SparkJobSubmitter` note below for why this specific field isn't
  populated by today's in-process engine), and (c) the persisted
  `PipelineRunRecord.errorLog` (`PipelineRunHistoryRoutes` via
  `PipelineRunService.history()`).
- After: genericized `errMsg` to the static `"Pipeline execution failed"` at
  construction (single point, so all three consumers inherit the fix), added
  `log.error(s"Pipeline execution failed for pipeline ..., run ...", ex)`
  immediately before.
- Verified with tests exercising two of the three live consumers directly
  (see Tests section): (a) SSE `errorLog` and (c) persisted
  `PipelineRunRecord.errorLog` via `run-history`. See the `SparkJobSubmitter`
  note for consumer (b).

### `services/SourceService.scala` — `refreshSql`/`refreshRest`/`previewSql`/`previewRest` `BadGateway` arms (4 sites) — FIX (simplified, not double-wrapped)

- Before: `Left(ServiceError.BadGateway(s"SQL execution failed: $err"))` /
  `s"Fetch failed: $err"`, wrapping the connector's already-partially-raw
  `err` string with a second static prefix.
- After: once `SqlConnector`/`RestApiConnector` (§3) return a generic,
  curated `err` (no raw exception tail — see below), the wrapping prefix
  becomes redundant (`"SQL execution failed: SQL execution failed"`).
  Simplified to `Left(ServiceError.BadGateway(err))` — `err` is already safe.
  `inferSql`/`inferRest` (`SourceService.scala:155,167`) already passed `err`
  through unwrapped and needed no change.

## Domain / service-support connectors (§3)

### `domain/SqlConnector.scala:88` — FIX

- Before: `.toEither.left.map(e => s"SQL execution failed: ${e.getMessage}")`
  (raw JDBC/driver exception text, e.g. SQLSTATE detail, appended).
- After: added a logger; `log.error("SQL execution failed", e)` then return
  the static `"SQL execution failed"` (prefix preserved, not sensitive).

### `domain/RestApiConnector.scala:56` (JSON-parse failure) — FIX

- Before: `s"Failed to parse JSON response: ${e.getMessage}"`.
- After: `log.error(...)` then `"Failed to parse JSON response"`.

### `domain/RestApiConnector.scala:62` (request `.recover`) — FIX

- Before: `s"Request failed: ${e.getMessage}"`.
- After: `log.error(...)` then `"Request failed"`.

### `domain/RestApiConnector.scala:58` (`Left(s"HTTP ${status}: $body")`) — CONFIRM-SAFE (unchanged)

- Not in the `getMessage`/exception-leak class: `body` is the literal
  response body returned by the external endpoint *the requesting user
  configured*, not internal exception/driver detail. Preserving it is useful
  diagnostic feedback for a misconfigured REST source (per design.md's goal
  of preserving curated, non-sensitive client feedback) and was not in the
  design's enumerated candidate list.

### `services/ContentSourceSupport.scala:133` (`resolveValidated`, DNS resolve failure) — FIX

- Before: `Left(s"Could not resolve host '$host': ${e.getMessage}")`.
- After: added a logger; `log.warn(s"Could not resolve host '$host'", e)`
  then `Left(s"Could not resolve host '$host'")` — kept the curated prefix
  and the caller-supplied hostname (not sensitive), dropped the raw resolver
  exception tail.

### `services/ContentSourceSupport.scala:234` (`fetchUrl`'s request `.recover`) — FIX

- Before: `Left(s"Request failed: ${e.getMessage}")`.
- After: `log.error("Content source URL fetch failed", e)` then
  `Left("Request failed")`.

### `services/PdfTextSupport.scala:44` (`validate`'s `IOException` arm) — FIX

- Before: `Left(s"File is not a valid PDF: ${e.getMessage}")`.
- After: added a logger; `log.warn("File is not a valid PDF", e)` then
  `Left("File is not a valid PDF")`.

### `domain/panels/PanelConfigCodec.scala` — `safe`'s `case e: Throwable` arm — FIX

- Before: `Left(s"config decode failed: ${e.getMessage}")`.
- After: added a logger; `log.error("config decode failed", e)` then
  `Left("config decode failed")`.

### `domain/panels/PanelConfigCodec.scala` — `safe`'s `case d: DeserializationException` arm — CONFIRM-SAFE (unchanged)

- Audited every `deserializationError(...)` call site under
  `domain/panels/*` (52 call sites via `grep -rn "deserializationError"`):
  every message is a static/curated string built from caller-supplied field
  names/values (e.g. `"Expected string for DataTypeId, got $x"`,
  `"Invalid layout value: '$s'. Valid values: ..."`) — never a wrapped raw
  exception. `DeserializationException.getMessage` is therefore always safe
  to return verbatim. This also makes `PanelService.scala:262`'s
  `IllegalArgumentException(err).getMessage` safe by construction (see
  above).

### `domain/PipelineAnalyzeService.scala:129,181,212,246,262` (5 sites: `compute`, `splittext`, `extractheadings`, `chunkbytokencount`, `parseConfig` fallback) — FIX

- Before: each `catch { case ex: Exception => (schema, Some(s"<op> config error: ${ex.getMessage}")) }`.
- After: added a companion-object logger; each site now does
  `log.warn("<op> config error", ex)` then returns the static
  `"<op> config error"` category message (still signals which step/op is
  misconfigured; the analysis-response UI reads this field per-step).

### `domain/InProcessPipelineEngine.scala:151` (`loadPdfRowsFromBytes`'s `Failure(e)` arm) — CONFIRM-SAFE (unchanged)

- Throws `IllegalArgumentException("PDF data source '<name>' (id=<id>) could
  not be parsed: " + e.getMessage)`. Traced every caller of
  `InProcessPipelineEngine.loadRows`/`executeWithStepCounts`: only
  `PipelineRunService` (both call sites: `previewStep` and `executeRun`).
  Both catch sites are fixed above (§2) to discard the *entire* incoming
  exception message and substitute a static string — so even though this
  exception's own message embeds raw PDFBox detail, it never reaches a
  client body; it is only passed to `log.error(..., ex)` upstream (log-only).

## 4xx route arms (§4)

### `api/routes/SourcePreviewRoutes.scala:42,49` — CONFIRM-SAFE (unchanged)

- `Try(json.convertTo[SqlInferRequest])` / `Try(json.convertTo[RestApiConfigPayload])`.
  Both wire types use spray-json's auto-derived `jsonFormat2`/`jsonFormat4`
  (`api/protocols/DataSourceProtocol.scala:406,345`). Auto-derived formats
  only ever throw `DeserializationException` with spray's own curated text
  (e.g. "Object is missing required member 'name'") — no raw internal
  exception detail. If `json` itself isn't even a `JsObject`, the
  `.asJsObject` call (outside the `Try`) throws the same curated
  `DeserializationException` uncaught, hitting Pekko's default
  `ExceptionHandler` (bare 500, per the `PipelineService.scala:210` finding
  above) — also safe.

### `api/routes/DataSourceRoutes.scala:110,118,126,134` — CONFIRM-SAFE (unchanged)

- Same reasoning: `TextSourceUrlRequest`/`PdfSourceUrlRequest`/`ImageSourceUrlRequest`/`StaticDataSourceRequest`
  are all `jsonFormat3`/`jsonFormat3`/`jsonFormat3`/`jsonFormat4` auto-derived
  (`DataSourceProtocol.scala:349,352,355,415`).

### `api/routes/SourceRoutes.scala:42,50` — CONFIRM-SAFE (unchanged)

- Same reasoning: `SqlCreateSourceRequest`/`CreateSourceRequest` are
  `jsonFormat3`/`jsonFormat4` auto-derived (`DataSourceProtocol.scala:405,409`).

## Additional sites found by the grep-complete sweep (not in the design's enumerated list)

### `infrastructure/LocalFileSystem.scala:114` (`fromEnv`, `IOException` arm) — CONFIRM-SAFE (unchanged)

- Only called from `app/Main.scala` at process startup (`LocalFileSystem.fromEnv()`).
  A failure here crashes server boot; it can never reach an HTTP response.

### `infrastructure/PipelineStepRepository.scala:221` (`rowToDomain`'s `Failure(ex)` arm) — CONFIRM-SAFE (unchanged)

- Same shape and same reasoning as `PipelineService.scala:210` above:
  uncaught `IllegalStateException` → Pekko default `ExceptionHandler` → bare
  500, no body. See that entry for the verified default-handler behavior.

### `services/PipelineService.scala:430` (`classifyDbError`'s internal `msg` binding) — not a leak site

- `val msg = Option(e.getMessage).getOrElse(e.getClass.getName)` is used only
  to pattern-match (`msg.contains("violates foreign key constraint")`, etc.)
  for classification — the fixed version (see above) never returns `msg`
  itself to the client.

### `spark/SparkJobSubmitter.scala:94` (`submit`'s Spark-job `catch` arm) — FIX (defense-in-depth, not currently wired to any route)

- Before: `val errorMsg = Option(ex.getMessage).getOrElse(ex.getClass.getName)`,
  stored into both `cache.update(..., error = Some(errorMsg))` (which would
  back `RunStatusResponse.error` via `PipelineRunStatusRoutes`, the same wire
  type as consumer (b) of `PipelineRunService.executeRun`'s fix above) and
  `pipelineRunRepo.updateRunTerminalInternal(..., errorLog = Some(errorMsg))`.
- Reachability at the time of this audit: `SparkJobSubmitter` is constructed
  in `ApiRoutes` (per HEL-202's staged rollout) but `.submit(...)` is never
  invoked from any route or service in the current codebase — confirmed via
  `grep -rn "\.submit(" backend/src/main/scala/com/helio/` (only
  `PipelineRunSubmitRoutes` → `PipelineRunService.submit`, a different
  method, matches). `PipelineRunCache` is populated *only* by
  `SparkJobSubmitter` (`grep -rn "cache\.\(put\|update\)"` — no other
  producer exists), so `GET /pipelines/:id/runs/:runId`
  (`PipelineRunStatusRoutes`, backed by that same cache) currently always
  returns 404 for any pipeline executed via the shipped in-process engine.
  This surface is dead code today, not reachable via any live route.
- Fixed anyway (cheap, 3-line change, identical bug class to the
  `PipelineRunService` fix immediately above it) so the exact fan-out surface
  (b) called out in the design's task list is safe end-to-end once HEL-202
  wires `SparkJobSubmitter` into the request path — rather than shipping a
  latent leak that would resurface the moment that ticket lands. Verified
  with the existing real-Spark integration test in `SparkJobSubmitterSpec`
  (strengthened — see Tests below), which exercises `cache.get(...).error`
  and the persisted `errorLog` directly.
- **Spinoff note**: when HEL-202 wires `SparkJobSubmitter.submit` into a live
  route, re-verify `RunStatusResponse.error` end-to-end via an HTTP-level
  test (the current test asserts against the cache/repo layer directly,
  since no route reaches this code path yet).

## Re-grep confirmation

```
$ grep -rn "getMessage\|getLocalizedMessage" backend/src/main/scala/com/helio/
backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala:110,118,126,134   # CONFIRM-SAFE (spray-json auto-derived, see §4)
backend/src/main/scala/com/helio/api/routes/OAuthRoutes.scala:160                     # CONFIRM-SAFE (classification-only, not in body)
backend/src/main/scala/com/helio/api/routes/SourcePreviewRoutes.scala:42,49           # CONFIRM-SAFE (spray-json auto-derived, see §4)
backend/src/main/scala/com/helio/api/routes/SourceRoutes.scala:42,50                  # CONFIRM-SAFE (spray-json auto-derived, see §4)
backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala:151             # CONFIRM-SAFE (unreachable to body, see above)
backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala:97              # CONFIRM-SAFE (curated DeserializationException, see above)
backend/src/main/scala/com/helio/infrastructure/LocalFileSystem.scala:114             # CONFIRM-SAFE (startup-only, unreachable)
backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala:221      # CONFIRM-SAFE (unreachable to body, see above)
backend/src/main/scala/com/helio/services/PanelService.scala:262                      # CONFIRM-SAFE (safe by construction, see above)
backend/src/main/scala/com/helio/services/PipelineService.scala:210                   # CONFIRM-SAFE (unreachable to body, see above)
backend/src/main/scala/com/helio/services/PipelineService.scala:430                   # not a leak site (internal classification only)
```

No residual site returns raw exception text, `PSQLException`/JDBC detail, or
internal driver detail in a response body. Every remaining `getMessage`/
`getLocalizedMessage` occurrence above is either (a) never assembled into a
client-facing string, (b) guaranteed-curated text by construction, or (c)
unreachable from any HTTP route.

## PSQLException review

`grep -rn "PSQLException" backend/src/main/scala/com/helio/`:

- `services/PermissionService.scala:47`, `services/PipelinePermissionService.scala:52`:
  `case _: PSQLException => Left(ServiceError.Conflict("Permission already exists"))`
  — CONFIRM-SAFE, already a static curated message, no raw detail extracted.
- `services/PipelineService.scala:412` (`classifyDbError`): FIX, covered above.

## Tests

- `backend/src/test/scala/com/helio/api/GoogleOAuthRoutesSpec.scala` — new
  test: OAuth callback unexpected-failure catch-all returns a generic `500`
  body (no raw exception text) and logs the full exception via a logback
  `ListAppender` attached to `OAuthRoutes`'s logger.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — new test:
  `GET /api/auth/me` with a failing stubbed `UserRepository` returns a
  generic `500` body and logs the detail (same `ListAppender` pattern).
- `backend/src/test/scala/com/helio/services/PanelServiceBatchUpdateErrorSpec.scala`
  (new file) — `PanelService.batchUpdate` with a mocked `PanelRepository`
  whose `batchUpdate` fails: asserts the returned `ServiceError.message` is
  the generic `"Batch update failed"` (no raw exception text) and that the
  detail is logged.
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` —
  strengthened three existing tests to assert exact generic messages (not
  just `should include`) and explicit `should not include <raw detail>`
  checks, covering all three `PipelineRunService.executeRun` fan-out
  surfaces reachable via the live in-process engine: the direct `422`
  response body, the SSE `errorLog` event (added a new failure-path SSE
  test), and the persisted `PipelineRunRecord.errorLog` via run-history.
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala` —
  strengthened the existing Spark-failure test to assert the persisted
  `errorLog` and the `PipelineRunCache` entry's `error` field are both the
  exact generic `"Pipeline execution failed"` string, with an explicit
  `should not include "nonexistent_column"` (the raw Spark analysis
  exception detail) check.

All 1395 backend tests pass (`sbt test`), including the above.

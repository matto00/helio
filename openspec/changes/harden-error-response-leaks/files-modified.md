## Backend — production code

- `backend/src/main/scala/com/helio/api/routes/OAuthRoutes.scala` — added a logger; the catch-all OAuth-exchange failure now logs the full exception and returns a generic `500` body instead of `ex.getMessage`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — added a logger; `GET /api/auth/me` and `PATCH /api/users/me/update` `Failure(ex)` arms now log the exception and return a generic `500` body.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — `classifyDbError` (companion object) now logs and returns generic per-category messages instead of raw PSQLException/JDBC text; `addStep`/`updateStep` config-decode failures now log and drop the raw decode-exception tail from the `Invalid '<type>' config` message.
- `backend/src/main/scala/com/helio/services/PanelService.scala` — `batchUpdate`'s DB-failure `.recover` now logs and returns a generic `"Batch update failed"` message instead of the raw exception.
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — `previewStep` and `executeRun`'s run-failure `errMsg` (which fans out to the SSE `errorLog` event, `RunStatusResponse.error`, and the persisted `PipelineRunRecord.errorLog`) now genericize at construction, logging the cause once and dropping the raw exception tail everywhere it fans out.
- `backend/src/main/scala/com/helio/services/SourceService.scala` — the four `BadGateway` arms (`refreshSql`/`refreshRest`/`previewSql`/`previewRest`) now pass the connector's already-generic `err` through unwrapped instead of double-prefixing it.
- `backend/src/main/scala/com/helio/domain/SqlConnector.scala` — `execute`'s JDBC failure now logs the cause and returns the static `"SQL execution failed"` instead of appending raw driver text.
- `backend/src/main/scala/com/helio/domain/RestApiConnector.scala` — JSON-parse and request-failure arms now log the cause and return generic category messages instead of raw exception text.
- `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala` — DNS-resolve and URL-fetch failure arms now log the cause and drop the raw exception tail from the client-facing message.
- `backend/src/main/scala/com/helio/services/PdfTextSupport.scala` — PDF-validation `IOException` arm now logs the cause and returns the static `"File is not a valid PDF"` message.
- `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` — the `safe` helper's generic `Throwable` catch arm now logs and returns a static `"config decode failed"` message (the `DeserializationException` arm is unchanged — audited as always-curated, see `audit.md`).
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — all 5 per-op `config error` catch arms (`compute`, `splittext`, `extractheadings`, `chunkbytokencount`, the shared `parseConfig` fallback) now log the exception and drop the raw tail, keeping the curated `"<op> config error"` category.
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — the Spark-job failure `catch` arm now logs the exception and stores a generic `"Pipeline execution failed"` message in the run cache/persisted record instead of raw exception text (defense-in-depth; not yet wired to any live route — see `audit.md`).

## Backend — tests

- `backend/src/test/scala/com/helio/api/GoogleOAuthRoutesSpec.scala` — new test: OAuth callback's unexpected-failure catch-all returns a generic `500` with no raw exception text and logs the detail (logback `ListAppender`).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — new test: `GET /api/auth/me` with a failing stubbed `UserRepository` returns a generic `500` and logs the detail.
- `backend/src/test/scala/com/helio/services/PanelServiceBatchUpdateErrorSpec.scala` — new file: `PanelService.batchUpdate` DB-failure path returns the generic `"Batch update failed"` message and logs the detail.
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` — strengthened three existing pipeline-run-failure tests to assert exact generic messages (not raw-text-containing) across the direct response body, a new SSE failure-path test, and the persisted run-history `errorLog`.
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala` — strengthened the existing Spark-failure test to assert the persisted `errorLog` and cache `error` are the exact generic message, with an explicit check that the raw Spark analysis exception text does not leak.

## OpenSpec change artifacts

- `openspec/changes/harden-error-response-leaks/audit.md` — new file: full site-by-site audit (FIX/CONFIRM-SAFE) with before/after text and re-grep confirmation.
- `openspec/changes/harden-error-response-leaks/tasks.md` — all tasks marked complete; added a deviation note on task 6.4 (see `audit.md`'s `SparkJobSubmitter` entry).

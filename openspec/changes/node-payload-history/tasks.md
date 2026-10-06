## Standing Constraints

- [C1] Payload cap: rows<=PAYLOAD_HISTORY_MAX_ROWS (1000) AND compact JSON bytes<=PAYLOAD_HISTORY_MAX_BYTES (1 MiB); over either -> no payload, summary still written, WARN. Never truncate.
- [C2] Opt-in is outputs.config.historyPayloads (boolean, default off), 400 on non-boolean; no UI/MCP toggle.
- [C3] RLS proofs run as NOSUPERUSER non-BYPASSRLS app role + separate helio_privileged; never as superuser.
- [C4] Do not settle HEL-1285; do not touch .github/workflows/ci.yml or playwright.config.ts; record exact ids of any shared-dev-DB rows created (prefer EmbeddedPostgres).
- [C5] Every new dependency is wired in Main/ApiRoutes with a failing signal if missing: retention service takes the payload repo/config as NON-defaulted params; a test builds ApiRoutes from dbContext only (as Main does) and observes a stored payload.

### Backend

## 1. Migration

- [x] 1.1 Add V116__node_payload_history.sql per design D-1 (table, CHECK, index, RLS ENABLE+FORCE, 4 policies, GRANT helio_privileged, output_snapshot_history.payload_id FK ON DELETE SET NULL + index); verify `sbt testFull` migrates
- [x] 1.2 Register the table in RlsPolicyGuardSpec, RlsPrivilegedDmlSpec and FlywayNonSuperuserMigrationSpec; verify those specs pass

## 2. Config and opt-in

- [x] 2.1 Add PayloadHistoryConfig.fromEnv (D-4) with defaults and WARN fallback; 0 or negative MAX_ROWS/MAX_BYTES falls back to default with WARN; verify with a config spec
- [x] 2.2 Add PayloadOptIn.validateConfig/enabled (D-2) and chain it beside OutputCompare.validateConfig in OutputService and PipelineService; verify non-boolean -> 400 spec

## 3. Write path

- [x] 3.1 Add NodePayloadHistoryRepository.writeAction (tier lookup, insert, per-node trim; D-3) in a new file; verify repository spec
- [x] 3.2 Add payloadId to OutputHistoryInsert and OutputHistoryPoint (both defaulted None)/HistoryTable and read it back on points; verify existing L1/L8 specs still compile and pass
- [x] 3.3 Wire PipelineRunService per D-3: decide only "some Output on this node opted in", pass rows + caps to writeAction inside overwriteRowsWith's andThen (writeAction: tier first, then row count, then compact-JSON bytes; WARN+None only for a payload-allowing tier), then insertAction linking only opted-in points; verify run-service spec

## 4. Retention

- [x] 4.1 Add NodePayloadHistoryRepository.purge (age, newest-N, zero/unknown tier, unreferenced; own advisory lock) and call it from OutputHistoryRetentionService after thinAndPurge; verify retention spec

## 5. Read route and docs

- [x] 5.1 Add OutputHistoryService.payloadRows and `GET /api/outputs/:id/history/:point/rows` (D-6) with its JSON protocol; verify route spec
- [x] 5.2 Add point `id`/`hasPayload` to OutputHistoryPoint (payloadId) and the authenticated OutputHistoryPointResponse only (D-7); public point unchanged; verify existing L3 specs pass
- [x] 5.3 Schemas: historyPoint id/hasPayload, new output-history-payload-response.schema.json, config.historyPayloads in the 3 request schemas; verify `npm run check:schemas`
- [x] 5.4 Production wiring (D-8): build NodePayloadHistoryRepository + PayloadHistoryConfig.fromEnv() once in Main; thread via ApiRoutes (derive from dbContext when absent) into PipelineRunService and OutputHistoryService; OutputHistoryRetentionService takes them as NON-defaulted params; verify `sbt compile` and test 6.9
- [x] 5.5 Mirror point `id`/`hasPayload` in helio-mcp/src/types.ts OutputHistoryPoint; verify `npm run typecheck` in helio-mcp
- [x] 5.6 Update CLAUDE.md env-var table (PAYLOAD_HISTORY_*) and endpoint list; verify by grep

### Tests

## 6. Tests

- [x] 6.1 Repository/run-service spec (EmbeddedPostgres): opted-in beta writes payload linked only to opted-in points; opted-out writes none; free tier writes nothing; dry run and a blocked run write nothing
- [x] 6.2 Size-cap spec: rows over cap and bytes over cap (low env caps) -> no payload, summary present, over-cap WARN captured; exactly-at-cap stores (multi-byte UTF-8 content; bytes = compactPrint.getBytes(UTF_8).length, not String.length); a free-tier opted-in node over both caps logs NO over-cap WARN
- [x] 6.3 Atomicity spec: a forced payload insert failure rolls back the node's snapshot replace and summary insert
- [x] 6.4 Trim/purge spec: 11th beta write keeps 10; age purge; owner->free downgrade purges payloads but keeps points; unreferenced payload purged after thinning
- [x] 6.5 Two-role RLS spec as helio_app_test (NOSUPERUSER, non-BYPASSRLS): owner and grantee see the row, stranger sees zero; helio_privileged write/purge works without extra grants; red: replace node_payload_history_select with USING (true) -> stranger now sees the row (and/or drop it -> owner+grantee see zero, V94OutputsMigrationSpec:962 shape), then restore
- [x] 6.6 Route spec extending com.helio.testkit.HelioRouteTest: history list ids with hasPayload=true resolve to 200 rows in order (owner, grantee) and the 200 body (incl. runId null) validates against output-history-payload-response.schema.json via JsonSchemaValidation, hasPayload=false id 404, stranger 404, foreign point 404, non-UUID 404
- [x] 6.7 Public spec on a shared dashboard whose Output has a stored payload: public history points have no id/hasPayload/payloadId/rows key; `/api/dashboards/:d/panels/:p/history/<realPointId>/rows`: PublicDashboardRoutes alone does not handle it (`handled shouldBe false`), and full ApiRoutes anonymous and token-only -> 401 with no row data
- [x] 6.8 Deleting a pipeline that has payloads and linked points succeeds (both cascade paths)
- [x] 6.9 Wiring test: ApiRoutes built from dbContext only (as Main builds it), real opted-in run via the API stores a payload readable on the rows route; retention service built as Main builds it purges a downgraded tier's payload
- [x] 6.10 Update any test teardown that TRUNCATEs pipelines/outputs/output_snapshot_history without CASCADE for the new FK chain; verify full suite
- [x] 6.11 Run `node scripts/check-node-root-encoding.mjs` and its selftest green; run `nice -n 19 sbt testFull` green and frontend gates unaffected

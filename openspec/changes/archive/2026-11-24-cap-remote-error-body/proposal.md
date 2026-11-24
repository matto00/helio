## Why

A failed REST fetch's error text is built as `HTTP <code>: <full remote body>` and reaches the assistant's
`test_connection` tool result (model context), the proposal-apply blocked-run reason, stored source `fetchError`, the
persisted run `error_log` and several API responses uncapped. HEL-1727 capped only the propose-time dry run. A large or
hostile remote body can still flood the model's context and stored rows.

## What Changes

- Move HEL-1727's cap (`PipelineRootDryRun.capFetchError`, 500 code points + ` … [truncated]`, surrogate-safe) into
  one shared helper in the connector domain layer. No new cap value.
- Apply it to the body-bearing error text in both `RestApiConnectorDriver` builders (`issueAndParse`, `issueTest`), so
  every consumer of those errors receives capped text.
- `PipelineRootDryRun` keeps capping through the same helper (it also covers non-REST fetch errors).
- Side effect: stored source `fetchError` and run `error_log` text from a REST HTTP error are now capped too.
- No helio-mcp change expected (it only relays backend text).

## Capabilities

### New Capabilities

### Modified Capabilities
- `fetch-error-envelope`: adds a requirement that a REST connector's remote HTTP error text is capped at the connector.

## Impact

- `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala` (both builders)
- New shared helper in `com.helio.domain.connectors`; `PipelineRootDryRun` delegates to it.
- Tests: driver spec, `test_connection` (assistant tool / `SourceService.testRest`) and proposal apply blocked-run
  reason, each through the real driver against a local stub server.
- No migration, no API shape change, no frontend change.

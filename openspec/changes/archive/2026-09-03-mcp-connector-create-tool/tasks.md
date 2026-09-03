## 1. MCP client layer

### Backend

- [x] 1.1 Add `CreateConnectorResult` (id/name/kind/host — no credential field) to `helio-mcp/src/types.ts`, mirroring the backend's `ConnectorMeta` projection already used by `ConnectorSummary`.
- [x] 1.2 Add `HelioApi.createConnector({name, kind, baseUrl})` in `helio-mcp/src/helioApi.ts`: `POST /api/connectors` with `config: {authType: "none"}` and a hardcoded literal `credential: ""` (Decision 1 — never a parameter), mapping the response by field to `CreateConnectorResult`, never by spread.

## 2. MCP tool surface

### Backend

- [x] 2.1 Extract `rejectCredentialField` from `helio-mcp/src/tools/restDataSourceSchema.ts` into a new `helio-mcp/src/tools/credentialDenylist.ts` parameterized on BOTH varying axes — tool name and correct alternative (Decision 3); re-export/consume it from `restDataSourceSchema.ts` so its existing message text is byte-identical to today's (Decision 3).
- [x] 2.2 Add `helio-mcp/src/tools/connectorSchema.ts`: `.strict()` schema with `name`, `baseUrl`, optional `kind` (default `rest_api`), optional `authType` enum `none|bearer|api_key`, plus the five denylist fields whose message names the `/connectors` out-of-band path. No `defaultHeaders` and no other request-shaping input (Decision 4).
- [x] 2.3 Register `create_connector` in `helio-mcp/src/tools/write.ts` using the same `guarded` wrapper as its siblings (Decision 6); handler refuses any `authType !== "none"` before any HTTP call, returning the `/connectors` next-step message (Decision 2).
- [x] 2.3b Add the constant `note` field to `create_connector`'s success result naming `/connectors` for hosts that turn out to require authentication (Decision 4b(i) — the guaranteed signpost on the undeclared path).
- [x] 2.3c Append the `/connectors` pointer to `create_rest_data_source`'s returned `fetchError` when the backend message indicates 401/403 (Decision 4b(ii), best-effort; must not alter `fetchError` for any other failure).
- [x] 2.4 Write the `create_connector` tool description: states it creates unauthenticated Connectors only, that it accepts no credential under any key, that credentials are never returned, and that a credentialed host is completed by a human at `/connectors`.
- [x] 2.5 In `helio-mcp/src/tools/read.ts`, append a second text content block to `list_connectors`' result naming `create_connector` when and only when the list is empty; the JSON payload stays a bare array (Decision 5).
- [x] 2.6 Give `connectorId` in `restDataSourceSchema.ts` a custom required/min-length message naming both `list_connectors` and `create_connector`; add no field and remove none.

## 3. Documentation

- [x] 3.1 Update `helio-mcp/README.md`'s tool inventory with `create_connector` and its credential-less scope.

## 4. Tests

### Tests

- [x] 4.1 Extend `helio-mcp/src/tools/restDataSourceSchema.test.ts` — the existing denylist assertions MUST pass unmodified after task 2.1's extraction; add a case asserting the missing-`connectorId` message names both tools.
- [x] 4.2 New `helio-mcp/src/tools/connectorSchema.test.ts`: `.strict()` rejects unknown keys; each of the five denylist fields rejects with a message naming the out-of-band path; a valid credential-less input parses.
- [x] 4.3 Unit-test `HelioApi.createConnector` against a stubbed http client: asserts the posted body carries `authType: "none"` and `credential: ""` and contains no other credential-shaped key, and that the mapped result carries no credential field.
- [x] 4.4 Handler tests for `create_connector`: `authType: "bearer"` and `authType: "api_key"` each refuse with a `/connectors`-naming message AND make zero http calls (assert on the stub's call count — this is the no-half-created-state proof); a backend error is surfaced verbatim.
- [x] 4.5 Test `list_connectors`' empty-result hint: empty list yields the extra text block naming `create_connector`; a non-empty list yields exactly one content block and no hint.
- [x] 4.5b Test 2.3b's constant note is present on every `create_connector` success, and 2.3c's `fetchError` augmentation fires for a 401/403 message and leaves every other `fetchError` byte-identical.
- [x] 4.6 Update `helio-mcp/src/server.test.ts`'s registered-tool-name list to include `create_connector`.
- [x] 4.7 New `helio-mcp/e2e/connector-authoring.ts` (Decision 8) in three explicitly separated phases: SETUP (out-of-band, pre-measurement) registers a run-unique throwaway user via `POST /api/auth/register` and mints a PAT via `POST /api/tokens`; MEASURED spawns the MCP server under that PAT and does `list_connectors` (empty + hint) → `create_connector` → `create_rest_data_source` → pipeline/Output through MCP tool calls only, holding no HTTP client in that phase; TEARDOWN (out-of-band, post-measurement) deletes the created Connector via `DELETE /api/connectors/:id`.
- [x] 4.7b Preflight the public host (`https://api.sleeper.app`, endpoint `/v1/state/nfl`) before the measured phase; on unreachable egress exit NON-ZERO with a message naming the host and the outbound-network requirement — never downgrade to a static source, never skip, never report success (Decision 8 / skeptic-design-2 CR1). The same preflight also checks `CONNECTOR_MASTER_KEY` is set (`credential: ""` still goes through `secretBackend.encrypt`, so an unset key 500s on the first measured step) and fails with that named cause rather than an opaque 500 (skeptic-design-3).
- [x] 4.7c Give the measured phase hard pass criteria the script FAILS on (skeptic-design-2 CR2): the created source's `inferredSchema` is non-null AND its `fetchError` is null (a fetch-failed source still returns HTTP success, so absent these two a broken source would pass), AND the Output at the end of the pipeline leg materializes a non-empty row set.
- [x] 4.8 Run the e2e against the worktree's own backend and record its transcript as the AC-5 measurement — the acceptance evidence is this run, not the tool list. Confirm in the transcript that the measured phase issued zero direct HTTP calls and that 4.7c's assertions all evaluated.

## 5. Follow-up

### Follow-up

- [x] 5.1 File the deferred pending-connector-handoff follow-up ticket (AC3's filing half) and record its HEL-id into design.md Decision 7's placeholder — an unfiled follow-up leaves this task and that slot visibly incomplete. FILED: HEL-955.

## Context

`helio-mcp` (HEL-148) exposes the canonical DataSource → Pipeline → DataType → Panel chain, but
`create_data_source` (`helio-mcp/src/tools/write.ts`) is static-only. The backend already has full
CSV/REST/SQL support:

- CSV: `POST /api/data-sources` as `multipart/form-data` (`DataSourceRoutes.createCsvRoute`) — no
  CSV-by-URL endpoint exists.
- REST/SQL: `POST /api/sources`, dispatching on the JSON body's `type` field
  (`SourceRoutes.scala`), handled by `SourceService.createRest`/`createSql`. Returns
  `CreateSourceResponse { source, dataType, fetchError }` — a different envelope from
  `create_data_source`'s flat `DataSourceResponse`.
- Credential redaction already happens in `DataSourceResponse.fromDomain` (`redactRestPayload`
  masks bearer tokens/api-key values to `"***"`; `redactSqlPayload` masks non-empty passwords),
  applied uniformly regardless of call site — `CreateSourceResponse.source` goes through the same
  `fromDomain` conversion, so it's redacted for free.
- SQL query safety: `SqlConnector.checkQuery` rejects DDL/DML keywords server-side; 30s query
  timeout + `maxRows` cap are already enforced. No new guardrails needed at the MCP layer.

`helio-mcp`'s `HelioHttpClient` (`httpClient.ts`) only sends JSON bodies today — it has no
multipart support, needed for the CSV tool.

## Goals / Non-Goals

**Goals:**
- Three new MCP tools mirroring `create_data_source`'s contract: create the source and point the
  agent at `create_pipeline` next. For REST/SQL this includes the auto-created companion
  DataType (the backend's `CreateSourceResponse` returns it); for CSV it does not — like the
  existing `static` tool, `DataSourceService.createCsv` creates the companion DataType server-side
  but the route only ever returns the flat `DataSourceResponse` (no `dataType` field) — the
  companion DataType still exists and is inspectable via `list_source_objects`, just not returned
  inline from the create call.
- CSV creation takes inline text content (the agent has content, not a filesystem path) and the
  tool builds the multipart body internally.
- Credentials (SQL password, REST bearer token / api-key value) are never echoed back — verified,
  not re-implemented, since backend redaction already covers this.

**Non-Goals:**
- CSV-by-URL — no backend endpoint exists; adding one is out of scope for an MCP-surface change.
- A standalone `infer_source_schema` tool — `list_source_objects` (existing) already surfaces
  shape once the source is created; agents don't need a pre-create preview to satisfy the AC.
- Refresh tooling (`POST /api/sources/:id/refresh`) — out of scope, not needed for the create →
  inspect → pipeline flow the AC describes.

## Decisions

**One tool per source kind, not one parameterized tool.** `create_csv_data_source`,
`create_rest_data_source`, `create_sql_data_source` are separate `server.registerTool` calls with
kind-specific `inputSchema`s (zod), rather than a single `create_source` tool with a discriminated
union input. Rationale: MCP tool descriptions and schemas are what the agent reads to decide
*what to pass*; a CSV tool needs `content`, a SQL tool needs `dialect/host/port/database/user/
password/query`, a REST tool needs `url/method/auth/headers` — cramming these into one optional-
everything schema (as static `create_data_source` avoided by being single-purpose) would produce
a worse agent experience than three small, precisely-typed tools. This also matches the backend's
own separation (`SourceRoutes` dispatches REST vs SQL by body `type`; CSV is a wholly separate
route/multipart shape).

**CSV tool takes `content: string`, not a file path.** The MCP process has no meaningful
relationship to the agent's filesystem (it's a headless server the agent's host process talks
to over stdio/HTTP); the natural shape for "agent has some CSV text, wants it as a source" is a
string, converted to a `Blob`/`FormData` part with Node's built-in `fetch` primitives (already the
only HTTP dependency — see `httpClient.ts`'s doc comment on staying dependency-light).

**`httpClient.ts` gets a `postMultipart` method**, parallel to the existing `post`/`patch`, using
`FormData`/`Blob` (both global in Node ≥18, matching the existing `fetch` usage) — no new
dependency.

**REST/SQL tools return the raw `CreateSourceResponse` shape** (`{ source, dataType, fetchError }`)
rather than reshaping to match `create_data_source`'s flat return. Rationale: `fetchError` is
meaningful signal (e.g. bad credentials, unreachable host) the agent needs to see and act on —
collapsing it away would hide a first-connection failure the agent should retry or report.

## Risks / Trade-offs

- **[Risk]** An agent could pass a SQL query that leaks data cross-tenant if `host`/`database`
  point outside the intended scope. → **Mitigation**: unchanged from the existing UI-driven flow —
  this ticket adds a new client of the same backend authorization boundary (`AuthenticatedUser`),
  not a new privilege. No new risk introduced.
- **[Risk]** Large CSV `content` strings passed through an MCP tool call could hit context/size
  limits before hitting the backend's `csvMaxBytes` check. → **Mitigation**: rely on the existing
  backend 413 (`RequestEntityTooLarge`) response, surfaced verbatim via `guarded()`; no client-side
  size pre-check needed for this ticket's scope.

## Planner Notes

- Self-approved: three separate tools over one polymorphic tool (agent-ergonomics judgment call,
  not an architectural change — no new external dependency, no breaking API change).
- Self-approved: CSV-by-URL and `infer_source_schema` excluded as non-goals — ticket says "backend
  already supports," and neither exists server-side.

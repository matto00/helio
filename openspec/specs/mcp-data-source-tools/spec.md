# mcp-data-source-tools Specification

## Purpose
Let an agent connect a real CSV, REST API, or SQL data source through MCP alone — closing the
gap where only inline `static` sources were agent-creatable and CSV/REST/SQL required the UI.

## Requirements

### Requirement: create_csv_data_source MCP tool
The MCP server SHALL expose a `create_csv_data_source` tool that accepts a `name` and inline CSV
`content` (text), posts it to the backend's CSV upload endpoint as multipart form data, and
returns the created source's id. The backend auto-creates a companion DataType for the source but
does not return it inline from this endpoint (same shape as the existing `static` tool); the
agent can inspect it via `list_source_objects` and build a pipeline over the returned source id.

#### Scenario: Agent creates a CSV source from inline content
- **WHEN** an agent calls `create_csv_data_source` with `name` and CSV `content`
- **THEN** the tool posts a multipart request to `POST /api/data-sources` and returns the created
  source's id, without requiring any filesystem access from the MCP process

#### Scenario: Oversized content is rejected verbatim
- **WHEN** the CSV `content` exceeds the backend's configured maximum upload size
- **THEN** the tool returns the backend's 413 error message unchanged, not a generic failure

### Requirement: create_rest_data_source MCP tool
The MCP server SHALL expose `create_rest_data_source`, creating a `rest_api` data source
against an existing Connector: required `connectorId` (referencing a Connector visible to the
caller via `list_connectors`), optional `endpoint`, `method` (default `GET`), `queryParams`,
per-source `headers`, `body`/`bodyContentType`, and `rootSelector`. The tool SHALL NOT accept a
`url` or any credential/auth field — the input schema is `.strict()`, so `url` and any
unrecognized key are rejected, and `auth`/`apiKey`/`token`/`password`/`credential` are explicit
fields that always fail validation with a message naming `connectorId`; an agent cannot supply a
credential under any name, and every rejection is loud, never a silent drop. The backend attempts
an initial fetch at creation time: on
success the response includes the auto-created companion DataType; on failure it returns
`dataType: null` and a `fetchError` message. The tool description SHALL state plainly that
credentials are never returned by this or any tool, so a model does not waste turns trying to
retrieve one.

#### Scenario: Agent creates a REST source with bearer auth
- **NOTE**: this scenario's title is retained verbatim from the pre-existing spec for archival
  name-continuity only. As of this change there is no `auth`/`bearer` input at all — the title
  describes the OLD tool shape this MODIFIED requirement replaces, not new behavior.
- **WHEN** `create_rest_data_source` is called against a Connector whose auth is already
  configured as `bearer`
- **THEN** the agent never supplies that bearer token — the tool's input schema rejects any
  `auth`/`bearer`/credential-shaped field (explicit denylist for the 5 named ones, `.strict()`
  for everything else); the Connector's configured auth is resolved and applied server-side,
  never passed through this call

#### Scenario: Agent creates a REST source against a Connector
- **WHEN** `create_rest_data_source` is called with a valid `connectorId` (obtained from
  `list_connectors`) and `endpoint`
- **THEN** the tool returns the created source id and, on a successful initial fetch, the
  linked DataType — with no credential value anywhere in the result

#### Scenario: Initial fetch fails
- **WHEN** `create_rest_data_source` is called with a `connectorId` whose resolved request
  returns a 4xx/5xx or is unreachable
- **THEN** the tool returns the created source id, `dataType: null`, and a `fetchError` message
  — never an opaque tool error

#### Scenario: An agent attempts to pass a credential inline
- **WHEN** `create_rest_data_source` is called with an extra `auth`/`apiKey`/`token`/`password`/
  `credential` field alongside or instead of `connectorId`
- **THEN** the tool's input schema explicitly rejects that field with a validation error naming
  `connectorId` as the correct way to supply credentials — a LOUD failure, not a silent strip, so
  an agent that thinks it configured auth is told immediately rather than authoring a source that
  silently fails to authenticate later; no source is created and the field never appears in any
  result

### Requirement: create_sql_data_source MCP tool
The MCP server SHALL expose a `create_sql_data_source` tool that accepts `name`, `dialect`,
`host`, `port`, `database`, `user`, `password`, and `query`, posts to the backend's SQL source
endpoint, and returns the created source, its auto-created companion DataType (if the initial
query succeeded), and any `fetchError`.

#### Scenario: Agent creates a SQL source
- **WHEN** an agent calls `create_sql_data_source` with connection details and a read-only `query`
- **THEN** the tool returns the created source id and companion DataType, and the `password` is
  never present in the tool's result

#### Scenario: Query contains a disallowed keyword
- **WHEN** `query` contains DDL/DML keywords (CREATE, DROP, ALTER, DELETE, INSERT, UPDATE,
  TRUNCATE)
- **THEN** the tool surfaces the backend's rejection verbatim; no source is created

### Requirement: Credentials never appear in tool results
None of the write tools introduced by this capability SHALL return raw credential values (SQL
passwords, REST bearer tokens, REST api-key values) in any success or error result.

#### Scenario: Redaction holds across success and error paths
- **WHEN** any of `create_csv_data_source`, `create_rest_data_source`, `create_sql_data_source`
  succeeds or fails
- **THEN** the tool's result contains no raw password, bearer token, or api-key value — success
  responses rely on the backend's existing redaction (`***`), and error messages never echo the
  submitted config

### Requirement: list_connectors MCP tool
The MCP server SHALL expose `list_connectors`, returning the caller's Connectors: `id`, `name`,
`kind`, and `host` (the base host/origin only) per entry. The credential SHALL NOT appear in
any form, including partially masked, truncated, or hashed. This tool is distinct from
`list_connector_types`, which lists connector *kind* capability metadata (no instances). The
tool description SHALL state plainly that credentials are never returned.

#### Scenario: Agent lists Connectors before authoring a source
- **WHEN** `list_connectors` is called
- **THEN** the result contains one entry per Connector visible to the caller, each with only
  `id`/`name`/`kind`/`host` — no credential field, masked or otherwise, appears anywhere in the
  JSON result

#### Scenario: No Connectors exist yet
- **WHEN** `list_connectors` is called by a caller with no Connectors
- **THEN** the result is an empty list, not an error

### Requirement: Connectors surfaced in the MCP workspace-context fan-out
`helio-mcp/src/context.ts`'s `buildWorkspaceContext` (the client-side fan-out backing the
`get_workspace_context` MCP tool and the `helio://workspace/context` resource — confirmed to
never read the backend's own `WorkspaceContextResponse` internally) SHALL include a `connectors`
list in its returned context object: one entry per Connector visible to the caller, with only
`id`/`name`/`kind`/`host`. This is a distinct addition from the backend `WorkspaceContextResponse`
field of the same shape (used by the in-app assistant) — both surfaces gain a Connectors block,
independently, because they are independently assembled.

#### Scenario: MCP workspace context includes the caller's Connectors
- **WHEN** `get_workspace_context` (or `helio://workspace/context`) runs for a caller with one or
  more Connectors
- **THEN** the returned context object's `connectors` field contains one entry per Connector,
  each with exactly `id`/`name`/`kind`/`host` — no credential field of any kind, and no
  `config`/`defaultHeaders` value

#### Scenario: A failed connectors fetch degrades that section only
- **WHEN** the `GET /api/connectors` fan-out call fails during `buildWorkspaceContext`
- **THEN** `connectors` degrades to an empty list, mirroring the existing degrade-that-section-only
  behavior for the sibling `agentContext` preferences/memory fan-out calls (see
  `mcp-context-agent-block`'s "A failed preferences or memory fetch degrades that section only")
- **AND** the overall `get_workspace_context` call still succeeds with the rest of the workspace
  snapshot intact — a Connectors-fetch failure never propagates into a whole-call failure

### Requirement: Creating a Connector from the MCP surface is forbidden
The MCP server SHALL NOT expose any tool that creates or updates a Connector's credential.
Agents may only reference Connectors that already exist, by id. This is a deliberate security
decision: creating a Connector requires supplying a secret, and any MCP tool accepting one would
pass that secret through a model context, defeating the epic's security property. Humans create
Connectors via the UI (HEL-824) or via HEL-829's in-chat capture flow, which is explicitly
designed to bypass the agent.

#### Scenario: No create/update-Connector tool exists
- **WHEN** the MCP server's tool list is enumerated
- **THEN** no tool name or description offers to create, update, or rotate a Connector's
  credential

### Requirement: create_csv_data_source accepts and documents a sourceUrl
The MCP `create_csv_data_source` tool SHALL accept an optional `sourceUrl` argument alongside the existing inline
`content`, forward it to the backend, and describe both inputs accurately in its tool description and input schema —
including that `sourceUrl` must be `https`, that it is mutually exclusive with `content`, and that only a URL-backed
source can refresh on a schedule. The description SHALL NOT advertise an input the tool does not accept; in
particular it SHALL NOT describe a caller-supplied filesystem `path`, which is not accepted.

The tool SHALL make `content` optional and require EXACTLY ONE of `content` / `sourceUrl`. Supplying neither or both
SHALL fail in the tool before any HTTP call, with a message naming both arguments and stating they are mutually
exclusive. `content` SHALL continue to post `multipart/form-data` unchanged; `sourceUrl` SHALL post JSON to the
same endpoint.

#### Scenario: The tool forwards sourceUrl as a JSON create
- **WHEN** `create_csv_data_source` is called with `sourceUrl`
- **THEN** it sends a JSON create request carrying that URL, not a multipart upload

#### Scenario: Inline content still posts multipart
- **WHEN** `create_csv_data_source` is called with `content`
- **THEN** it posts `multipart/form-data` exactly as before

#### Scenario: Neither or both arguments fails before any HTTP call
- **WHEN** `create_csv_data_source` is called with neither `content` nor `sourceUrl`, or with both
- **THEN** it fails with a message naming both arguments and stating they are mutually exclusive
- **AND** no HTTP request is issued

#### Scenario: The description matches the real surface
- **WHEN** the tool's description and input schema are read
- **THEN** they name `content` and `sourceUrl` as the accepted, mutually exclusive inputs, state the https-only rule,
  and describe no caller-supplied filesystem path

## MODIFIED Requirements

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

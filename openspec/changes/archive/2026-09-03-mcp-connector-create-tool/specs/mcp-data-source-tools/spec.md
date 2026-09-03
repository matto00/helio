## MODIFIED Requirements

### Requirement: Creating a Connector from the MCP surface is forbidden
The MCP server SHALL NOT expose any tool that supplies, updates, or rotates a Connector's credential
value. No MCP tool input schema SHALL accept a credential under any key: every schema on this surface
SHALL reject each key it does not recognize — by `.strict()`, or by an equivalent exhaustive
unrecognized-key check that is no more permissive — and SHALL additionally carry always-rejecting
`auth`/`apiKey`/`token`/`password`/`credential` fields whose validation error names the correct
alternative. This remains a deliberate security
decision: a secret must never pass through a model context.

This prohibition is scoped to secrets, not to Connector existence. Creating a **credential-less**
Connector (`authType: "none"`, an unauthenticated host) involves no secret and SHALL be permitted from
the MCP surface via `create_connector`. Humans still create credential-bearing Connectors via the UI
(HEL-824) or HEL-829's in-chat capture flow, both of which bypass the agent by design.

#### Scenario: No create/update-Connector tool exists
- **NOTE**: this scenario's title is retained verbatim from the pre-existing spec for archival
  name-continuity only. As of this change a credential-LESS `create_connector` tool does exist; what
  remains absent is any tool that supplies or updates a Connector's credential.
- **WHEN** the MCP server's tool list is enumerated
- **THEN** no tool offers to update or rotate a Connector's credential, and no tool accepts a
  credential-shaped field

#### Scenario: No credential-accepting or rotating tool exists
- **WHEN** the MCP server's tool list is enumerated
- **THEN** no tool name or description offers to supply, update, or rotate a Connector's credential,
  and no tool's input schema accepts a credential-shaped field

#### Scenario: An agent attempts to pass a credential to create_connector
- **WHEN** `create_connector` is called with an `auth`/`apiKey`/`token`/`password`/`credential` field,
  or with any key its schema does not recognize
- **THEN** validation fails loudly, identifying the offending key (in the message or the issue
  payload) and naming the out-of-band path, and no Connector is created — the field never reaches
  the backend, never reaches the tool handler, and never appears in any result

### Requirement: list_connectors MCP tool
The MCP server SHALL expose `list_connectors`, returning the caller's Connectors: `id`, `name`,
`kind`, and `host` (the base host/origin only) per entry. The credential SHALL NOT appear in
any form, including partially masked, truncated, or hashed. This tool is distinct from
`list_connector_types`, which lists connector *kind* capability metadata (no instances). The
tool description SHALL state plainly that credentials are never returned.

When the caller has no Connectors, the result SHALL additionally carry a message naming
`create_connector` as the way to obtain one, so an empty result is an actionable next step rather
than a dead end.

#### Scenario: Agent lists Connectors before authoring a source
- **WHEN** `list_connectors` is called
- **THEN** the result contains one entry per Connector visible to the caller, each with only
  `id`/`name`/`kind`/`host` — no credential field, masked or otherwise, appears anywhere in the
  JSON result

#### Scenario: No Connectors exist yet
- **WHEN** `list_connectors` is called by a caller with no Connectors
- **THEN** the result is an empty list, not an error
- **AND** the result carries a message naming `create_connector` as how to create one

### Requirement: create_rest_data_source MCP tool
The MCP server SHALL expose `create_rest_data_source`, creating a `rest_api` data source
against an existing Connector: required `connectorId` (referencing a Connector visible to the
caller via `list_connectors`, or created via `create_connector`), optional `endpoint`, `method`
(default `GET`), `queryParams`, per-source `headers`, `body`/`bodyContentType`, and `rootSelector`.
The tool SHALL NOT accept a `url` or any credential/auth field — the input schema is `.strict()`, so
`url` and any unrecognized key are rejected, and `auth`/`apiKey`/`token`/`password`/`credential` are
explicit fields that always fail validation with a message naming `connectorId`; an agent cannot
supply a credential under any name, and every rejection is loud, never a silent drop.

A missing or blank `connectorId` SHALL fail with a message that names both `list_connectors` and
`create_connector` as the ways to obtain one, rather than a bare "required" error.

The backend attempts an initial fetch at creation time: on success the response includes the
re-inferred `inferredSchema`; on failure it returns `inferredSchema: null` and a `fetchError` message.
The tool description SHALL state plainly that credentials are never returned by this or any tool, so a
model does not waste turns trying to retrieve one.

#### Scenario: Agent creates a REST source with bearer auth
- **NOTE**: this scenario's title is retained verbatim from the pre-existing spec for archival
  name-continuity only. There is no `auth`/`bearer` input at all — the title describes an OLD tool
  shape, not new behavior.
- **WHEN** `create_rest_data_source` is called against a Connector whose auth is already
  configured as `bearer`
- **THEN** the agent never supplies that bearer token — the tool's input schema rejects any
  `auth`/`bearer`/credential-shaped field (explicit denylist for the 5 named ones, `.strict()`
  for everything else); the Connector's configured auth is resolved and applied server-side,
  never passed through this call

#### Scenario: Agent creates a REST source against a Connector
- **WHEN** `create_rest_data_source` is called with a valid `connectorId` and `endpoint`
- **THEN** the tool returns the created source id and, on a successful initial fetch, the re-inferred
  `inferredSchema` — with no credential value anywhere in the result

#### Scenario: Initial fetch fails
- **WHEN** `create_rest_data_source` is called with a `connectorId` whose resolved request
  returns a 4xx/5xx or is unreachable
- **THEN** the tool returns the created source id, `inferredSchema: null`, and a `fetchError` message
  — never an opaque tool error

#### Scenario: An agent attempts to pass a credential inline
- **WHEN** `create_rest_data_source` is called with an extra `auth`/`apiKey`/`token`/`password`/
  `credential` field alongside or instead of `connectorId`
- **THEN** the tool's input schema explicitly rejects that field with a validation error naming
  `connectorId` as the correct way to supply credentials — a LOUD failure, not a silent strip; no
  source is created and the field never appears in any result

#### Scenario: connectorId is missing
- **WHEN** `create_rest_data_source` is called with no `connectorId`, or a blank one
- **THEN** validation fails with a message naming both `list_connectors` (to find an existing
  Connector) and `create_connector` (to create one for an unauthenticated host)

## ADDED Requirements

### Requirement: create_connector MCP tool
The MCP server SHALL expose `create_connector`, creating a credential-less Connector for an
unauthenticated host so that an MCP-only client can author a REST data source starting from a
workspace with zero Connectors, using only MCP tools and no out-of-band HTTP call.

The tool SHALL accept `name`, `baseUrl`, an optional `kind` (defaulting to `rest_api`), and an optional
`authType`. It SHALL NOT accept request-shaping configuration of any kind — in particular no
`defaultHeaders` or other free-form header/config map, which would be a credential-shaped channel;
per-source `headers` on `create_rest_data_source` is the intended channel for request shaping. Its
input schema SHALL be `.strict()` and SHALL reject every unrecognized key, identifying that key
(in the message or the issue payload) and naming the out-of-band path, and SHALL carry the
same always-rejecting credential denylist as `create_rest_data_source`. An unrecognized key SHALL
fail the parse outright, never merely be stripped or passed to the handler.

KNOWING CONCESSION (skeptic-final-2.md, coordinator-approved): an earlier draft of this requirement
demanded the offending key be named in the MESSAGE. `.strict()`'s message parameter is a fixed
string that structurally cannot interpolate the key, so satisfying that literal wording required
`.passthrough()` + a `superRefine`, which regressed the boundary in three ways (`__proto__` bypassed
the check entirely; the tool advertised an empty JSON Schema to clients; the refinement never ran
when the base parse aborted). The requirement is therefore deliberately narrowed to accept the key
in Zod's `issue.keys` payload instead of the message string. This is a real narrowing, recorded as a
decision rather than left for a reader to discover as a mismatch. The tool SHALL send
`authType: "none"` and an empty credential to `POST /api/connectors`; it SHALL NOT construct, forward,
or default any credential value. The created Connector's id SHALL be returned in a form directly usable
as `create_rest_data_source`'s `connectorId`. The tool result SHALL NOT contain a credential in any
form.

`POST /api/connectors`' existing validation — including HEL-879's create-time egress guard on
`baseUrl` — SHALL apply unchanged, and its refusal message SHALL be surfaced to the agent verbatim
rather than replaced with an opaque error.

#### Scenario: Agent creates an unauthenticated Connector from a clean workspace
- **WHEN** `create_connector` is called with a `name` and an `https` `baseUrl` for an unauthenticated
  host, by a caller with zero Connectors
- **THEN** a Connector is created with `authType: "none"` and an empty credential, and its id is
  returned — no credential value appears anywhere in the request this tool sends or in its result

#### Scenario: The created Connector is immediately usable
- **WHEN** `create_rest_data_source` is called with the `connectorId` returned by `create_connector`
- **THEN** the source is created against that Connector exactly as it would be for a
  UI-created Connector — no additional out-of-band step is required

#### Scenario: The backend refuses the baseUrl
- **WHEN** `create_connector` is called with a `baseUrl` the backend's create-time egress guard or URL
  validation refuses
- **THEN** no Connector is created and the backend's own refusal message is surfaced to the agent
  verbatim

### Requirement: Credentialed hosts get an actionable out-of-band next step
When an agent indicates, through `create_connector`, that the target host requires authentication —
by requesting any `authType` other than `none`, or by supplying any credential-shaped field — the
tool SHALL refuse without creating anything and SHALL return a message that names the out-of-band
path by which a human completes credential capture: the in-app `/connectors` page (HEL-824), or
HEL-829's in-chat capture flow. The message SHALL be an actionable instruction, not a bare
validation error, and SHALL make clear that the agent is not expected to obtain or handle the
secret itself.

#### Scenario: Agent requests an authenticated Connector
- **WHEN** `create_connector` is called with an `authType` of `bearer`, `api_key`, or any value
  other than `none`
- **THEN** no Connector is created, and the tool returns a message directing the caller to have a
  human create the Connector at the in-app `/connectors` page, explicitly naming that path

#### Scenario: The refusal does not leak into a half-created state
- **WHEN** `create_connector` refuses a credentialed request
- **THEN** no `POST /api/connectors` call is made and no partial or pending Connector row exists

#### Scenario: The agent never declared an authType but the host needs one
- **WHEN** `create_connector` succeeds on its default `authType: "none"` path
- **THEN** its result carries a constant note stating that a host which in fact requires authentication
  will fail its requests with 401/403 and that a human completes such a Connector at the in-app
  `/connectors` page — so the dead end is signposted without the agent having had to predict it

#### Scenario: A 401/403 initial fetch points at the out-of-band path
- **WHEN** `create_rest_data_source`'s initial fetch against a credential-less Connector fails with a
  message indicating 401 or 403
- **THEN** the returned `fetchError` additionally names the `/connectors` out-of-band path, rather than
  surfacing an authentication failure with no next step
- **AND** this augmentation is best-effort string matching over a backend-forwarded message; the
  preceding scenario's constant note, not this one, is the guaranteed signpost

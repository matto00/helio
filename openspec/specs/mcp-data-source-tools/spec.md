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
caller via `list_connectors`, or created via `create_connector`), optional `endpoint`, `method`
(default `GET`), `queryParams`, per-source `headers`, `body`/`bodyContentType`, and `rootSelector`.
The tool SHALL NOT accept a `url` or any credential/auth field — the input schema is `.strict()`, so
`url` and any unrecognized key are rejected, and `auth`/`apiKey`/`token`/`password`/`credential` are
explicit fields that always fail validation with a message naming `connectorId`; an agent cannot
supply a credential under any name, and every rejection is loud, never a silent drop.

`queryParams` SHALL accept BOTH the ordered array encoding — a JSON array of
`{"name": ..., "value": ...}` objects, which preserves duplicate names and authored order — and
the legacy JSON object encoding, whose keys are unique by construction. The array encoding SHALL
be forwarded to the backend unchanged and in the authored order, so that an agent can express a
repeated query key such as `?tag=a&tag=b` and have both values issued, in the order given. The
object encoding SHALL continue to be accepted and forwarded unchanged, so existing agent callers
keep working. The tool description SHALL tell the agent that the array form is the one that
expresses repeated keys and preserves order.

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

#### Scenario: An agent authors a repeated query key
- **WHEN** `create_rest_data_source` is called with `queryParams`
  `[{"name":"tag","value":"a"},{"name":"tag","value":"b"}]`
- **THEN** the request the MCP server sends to the backend carries both `tag` entries, in that
  order, rather than collapsing them to a single value

#### Scenario: Authored order is preserved, not alphabetized
- **WHEN** `create_rest_data_source` is called with an array `queryParams` whose names are in a
  deliberately non-alphabetical order
- **THEN** the request the MCP server sends carries those pairs in the authored order, not sorted
  by name

#### Scenario: The legacy object encoding still works
- **WHEN** `create_rest_data_source` is called with `queryParams` as a JSON object
- **THEN** the call is accepted and the object is forwarded to the backend unchanged, which
  decodes it through its legacy branch exactly as before this change

#### Scenario: A malformed queryParams entry is rejected loudly
- **WHEN** `create_rest_data_source` is called with `queryParams` as an array containing an entry
  that is not a `{name, value}` object
- **THEN** the call fails validation with an error naming the offending input, rather than
  silently dropping the entry

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

### Requirement: The agent surface initiates a credentialed Connector instead of refusing

The MCP `create_connector` tool SHALL, for a target host requiring authentication, create a pending
Connector and return that Connector's identifier together with a completion URL a human can open
out-of-band. It SHALL NOT refuse the request merely because the host requires a credential.

#### Scenario: A credentialed host yields a pending Connector and a completion URL
- **WHEN** an agent calls `create_connector` naming an auth type other than `none`
- **THEN** a pending Connector is created
- **AND** the result carries its `connectorId` and a completion URL
- **AND** the result states that a human must complete it before it can be used

#### Scenario: The unauthenticated path is unchanged
- **WHEN** an agent calls `create_connector` with auth type `none`
- **THEN** a Connector usable immediately is created, as before

#### Scenario: The agent observes completion by the source-creation call succeeding
- **WHEN** an agent attempts to create a REST source against a still-pending Connector
- **THEN** the call fails with a message identifying the Connector as awaiting completion
- **AND** the same call succeeds once the credential has been bound

### Requirement: The agent surface still accepts no credential value

The MCP tool surface SHALL continue to reject any credential value under any key. Introducing the pending
handoff SHALL NOT add a parameter that accepts a secret, and the existing strict-schema and denylist
protections SHALL remain in force on every connector-related tool.

#### Scenario: A credential-shaped key is rejected
- **WHEN** an agent calls a connector tool with a key naming a credential, token, password or secret
- **THEN** the call is rejected before any backend request is made
- **AND** no Connector is created or modified

#### Scenario: Unknown keys are rejected by strict schemas
- **WHEN** an agent calls a connector tool with any key the schema does not declare
- **THEN** the call is rejected

#### Scenario: The completion URL is not a credential channel
- **WHEN** an agent receives a completion URL
- **THEN** no tool accepts a credential value for that URL
- **AND** the credential reaches the backend only through the human-facing completion page

### Requirement: create_data_source exposes the full declared-schema shape

The `create_data_source` tool SHALL accept optional per-column `required` (boolean) and `default`
(any JSON value) fields in its `columns` input, in addition to the existing `name`/`type`, and
SHALL forward them to the backend unchanged, EXCEPT that an explicit `default: null` on a column
is currently indistinguishable from omitting `default` entirely (both collapse to "no default")
due to `StaticColumnPayload`'s wire format — this limitation SHALL be stated in the tool's
description, along with the workaround of using `update_dataset_schema` after creation (which does
preserve the no-default-vs-explicit-null distinction) when that distinction matters. `rows` MAY be
an empty array, creating a dataset with zero rows and only its declared schema. This is the one
dataset-creation path — there is no separate `create_dataset` tool — since the backend already
declares `dataset_schema` from `columns` at creation time (`DataSourceService.createStatic`)
rather than merely inferring it.

#### Scenario: Agent creates an empty dataset with a fully declared schema

- **WHEN** an agent calls `create_data_source` with `columns` including `required`/`default` on
  one or more fields, and an empty `rows` array
- **THEN** the tool creates a `dataset` source with that declared schema and zero rows, returning
  the source id

#### Scenario: Explicit null default at creation is documented as indistinguishable from no default

- **WHEN** an agent reads `create_data_source`'s tool description
- **THEN** it states that an explicit `default: null` on a column is currently indistinguishable
  from omitting `default`, and that `update_dataset_schema` should be used instead if the
  distinction matters

### Requirement: append_dataset_rows and replace_dataset_rows MCP tools

The MCP server SHALL expose `append_dataset_rows` (`POST /api/data-sources/:id/rows`) and
`replace_dataset_rows` (`PUT /api/data-sources/:id/rows`), each accepting a `dataSourceId` and a
`rows` array where each row is a **positional array of values** matching the dataset's declared
column order — the same shape `create_data_source`'s own `rows` input already uses, never an
object keyed by column name. A row is validated positionally against the dataset's declared
schema: a row LONGER than the declared schema is rejected outright (row-length error). For a row
no longer than the schema, each position is checked independently — a position that is either
ABSENT (the row is shorter than the schema) OR EXPLICITLY `null` is treated identically as
"missing": it is filled from that field's declared `default` if one exists, or left `null` if the
field is optional with no default, and rejected ONLY if the field is `required` with no `default`.
A present, non-null value that doesn't satisfy the field's declared type is rejected as a type
mismatch. Any rejection (row-length, a declared type mismatch, or a missing/null required field
with no default) SHALL be returned to the agent verbatim (naming the offending row and field), not
swallowed into a generic error. The tool descriptions SHALL state this padding behavior — for both
short rows and explicit `null` positions — accurately, rather than imply every arity/type mismatch
is rejected.

#### Scenario: Agent appends validated rows

- **WHEN** an agent calls `append_dataset_rows` with rows matching the dataset's declared schema
- **THEN** the rows are appended and the tool returns the created rows' ids/seq values

#### Scenario: Short row is padded, not rejected

- **WHEN** an agent calls `append_dataset_rows` with a row shorter than the dataset's declared
  schema, and every field past the row's length is optional or has a declared `default`
- **THEN** the row is accepted; missing trailing fields are filled from their `default` (or `null`
  if optional with no default), not rejected for arity

#### Scenario: Explicit null in a row position is treated as missing, not rejected

- **WHEN** an agent calls `append_dataset_rows` with a row containing an explicit `null` at a
  position for a field that is optional or has a declared `default`
- **THEN** the value is filled from that field's `default` (or left `null` if optional with no
  default), not rejected as a type mismatch

#### Scenario: Schema-violating row is rejected verbatim

- **WHEN** an agent calls `append_dataset_rows` or `replace_dataset_rows` with a row that is longer
  than the declared schema, has a declared-type mismatch on a present non-null value, or has a
  `required` field missing/`null` with no `default`
- **THEN** the tool returns the backend's validation error naming the offending row and field,
  not a generic failure

### Requirement: get_dataset_rows MCP tool

The MCP server SHALL expose a `get_dataset_rows` tool wrapping the paged
`GET /api/data-sources/:id/rows` endpoint, accepting `dataSourceId`, optional `cursor` (opaque,
from a prior response's `nextCursor`) and `limit`, and returning each row's `id`, `seq`, `data`,
and `updatedAt`, plus the response's `nextCursor` (absent once the last page is reached) and
`total` row count, so an agent can page through a large dataset and address a specific row for a
later edit or delete.

#### Scenario: Agent reads back appended rows

- **WHEN** an agent calls `get_dataset_rows` after appending rows
- **THEN** the tool returns the rows with their `id`/`seq`/`updatedAt`, sufficient to target a
  specific row with `update_dataset_row` or `delete_dataset_row`

#### Scenario: Agent pages through a large dataset

- **WHEN** an agent calls `get_dataset_rows` and the response includes a `nextCursor`
- **THEN** passing that value back as `cursor` on the next call returns the next page, and a
  response with no `nextCursor` means every row has been returned

### Requirement: get_dataset_schema and update_dataset_schema MCP tools

The MCP server SHALL expose `get_dataset_schema` (`GET /api/data-sources/:id/schema`) and
`update_dataset_schema` (`PATCH /api/data-sources/:id/schema`, full-replacement), each accepting
`dataSourceId`. `update_dataset_schema` SHALL accept a `fields` array (name, `previousName`
optional — required to express a rename, since its absence is a drop of the old name plus an add
of the new one, not a rename), `type`, optional `required`, and an explicit-vs-absent `default`
(a field with no `default` key means "leave/no default"; a `default` key present with a JSON
`null` value means an explicit null default), plus a top-level `confirmDrop` boolean required to
drop a field that has existing data. The tool descriptions SHALL state that this is a full
replacement, not a merge: any currently-declared field omitted from `fields` is dropped. A `409`
conflict (structured as `{rejectedFields, message}`, one entry per rejected field) SHALL be
returned to the agent verbatim, and a successful update's `{fields, rowsMigrated}` response SHALL
also be returned as-is.

#### Scenario: Agent inspects a dataset's declared schema

- **WHEN** an agent calls `get_dataset_schema` with a dataset's id
- **THEN** the tool returns its current declared column schema

#### Scenario: Agent renames a field without dropping it

- **WHEN** an agent calls `update_dataset_schema` with a field whose `previousName` names an
  existing column and whose `name` is the new column name
- **THEN** the backend treats it as a rename, not a drop-and-add, and the tool returns the updated
  schema with `rowsMigrated` reflecting the backend's own accounting

#### Scenario: Destructive edit is rejected without confirmDrop

- **WHEN** an agent calls `update_dataset_schema` omitting a field that has existing data, without
  `confirmDrop: true`
- **THEN** the tool returns the backend's `409 {rejectedFields, message}` body verbatim, and does
  not retry with `confirmDrop` on the agent's behalf

### Requirement: update_dataset_row and delete_dataset_row MCP tools

The MCP server SHALL expose `update_dataset_row` (`PATCH /api/data-sources/:id/rows/:rowId`) and
`delete_dataset_row` (`DELETE /api/data-sources/:id/rows/:rowId`), each requiring `dataSourceId`,
`rowId`, and the row's current `updatedAt` value as an optimistic-concurrency precondition.
`update_dataset_row` sends `updatedAt` in its JSON body (matching `RowPatchRequest`) and
additionally requires `data` — the row's complete new value as a positional array matching the
declared column order (a full replacement, never a partial/sparse update). `delete_dataset_row`
sends `updatedAt` as a **query parameter**, not a body field (the backend's `DELETE` route reads
it from the query string, and a missing value is a `400`, not a `404`) — the MCP client's DELETE
transport SHALL support attaching a query string for this tool. A precondition mismatch (the row
changed since the caller last read it) SHALL be returned to the agent verbatim as a conflict, not
retried or silently overwritten.

#### Scenario: Agent edits a row it just read

- **WHEN** an agent calls `update_dataset_row` with the `updatedAt` value from a prior
  `get_dataset_rows` call
- **THEN** the row is updated and the tool returns its new `updatedAt`

#### Scenario: Stale precondition is rejected, not retried

- **WHEN** an agent calls `update_dataset_row` or `delete_dataset_row` with an `updatedAt` value
  that no longer matches the row (it was edited concurrently)
- **THEN** the tool returns the backend's precondition-conflict error verbatim, and does not retry
  or overwrite the newer value

### Requirement: Dataset tool descriptions enumerate valid column types

Every MCP tool description that accepts or documents a dataset column's `type` string
(`create_data_source`, `get_dataset_schema`, and `update_dataset_schema`) SHALL enumerate the
valid canonical values inline, sourced from a single `helio-mcp`-local constant that is kept in
sync with the backend's canonical `DataFieldType` wire values by an automated drift-guard check —
never a hand-copied literal with no guard against the backend adding, removing, or renaming a
type.

#### Scenario: Agent reads the valid column types from a tool description

- **WHEN** an agent reads `create_data_source`'s, `get_dataset_schema`'s, or
  `update_dataset_schema`'s tool description
- **THEN** the description names every currently-valid column `type` string, matching the
  backend's canonical set exactly

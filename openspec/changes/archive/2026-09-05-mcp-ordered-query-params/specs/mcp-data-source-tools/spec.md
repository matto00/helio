## MODIFIED Requirements

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

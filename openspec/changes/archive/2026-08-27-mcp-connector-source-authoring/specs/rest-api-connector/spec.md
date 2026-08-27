## MODIFIED Requirements

### Requirement: Create a REST/HTTP data source
The backend SHALL expose `POST /api/sources` accepting a JSON body with `name`, discriminator
`type: "rest_api"`, and a `config` object containing `connectorId` (referencing an existing
Connector owned by the same user). Optional `endpoint` (default empty), optional `method`
(default `GET`), optional `queryParams`, optional per-source `headers`, optional `body` (with
optional `bodyContentType`, default `application/json`), optional `rootSelector` (a dot-path
locating the row array/object in the response, applied by `toRows`; unset reproduces today's
top-level-array/object behavior exactly). On success it SHALL insert the DataSource, attempt an
initial fetch+inference (resolving the referenced Connector's base host and credential), and if
inference succeeds, insert a DataType linked to the source. The response SHALL include
`fetchError` if the initial fetch failed. The system SHALL NOT accept a credential or auth
value directly on this request — a request containing one SHALL be rejected (400). A request
whose `method` is `GET` or `HEAD` and which also supplies a non-empty `body` SHALL be rejected
(400) — a body is never silently sent on a safe method.

**BREAKING, scoped to this HTTP endpoint only**: a bare `url` (no `connectorId`) in `config` is no
longer accepted by a direct `POST /api/sources` request. Decode stays total, unchanged, per the
existing invariant — this is a create-time validation-boundary check at the endpoint itself, not
a decode-path rejection. The response is 400, with an error message naming `connectorId`
explicitly and pointing at how to create a Connector first, not a generic decode failure.

This rejection applies ONLY to `POST /api/sources` itself — it is a wire-contract change for
direct API callers, not a change to how the underlying REST-source-creation capability resolves
a bare `url` when invoked internally (e.g. from an agent-authored pipeline proposal's inline
source resolution, which deliberately keeps bare-`url` support — see design.md Decision 1 for
why: agents cannot create Connectors, so this remains the only way to author a pipeline against a
no-auth public API without a human pre-creating a placeholder Connector). This also does NOT
affect any other bare-`url` resolution path: `RestSourceConnectorMigration`/`ImplicitConnectorConfig`
(pre-existing, already-stored legacy rows, converted once at migration time — see their own
requirement below) and the ephemeral, non-persisting infer/test-connection paths (see "Infer and
test-connection accept the legacy bare-url shape ephemerally" below, unmodified).

#### Scenario: Successful creation with schema registration
- **WHEN** `POST /api/sources` is called with a valid `connectorId` referencing the caller's
  own Connector, and the resolved URL returns a 2xx JSON response
- **THEN** the response is 201 with the created DataSource (no credentials) and a linked
  DataType in the registry

#### Scenario: Creation succeeds even when fetch fails
- **WHEN** `POST /api/sources` is called but the remote URL returns a 4xx/5xx or is unreachable
- **THEN** the response is 201 with the DataSource and a non-null `fetchError` field; no
  DataType is registered

#### Scenario: connectorId referencing another user's Connector returns 400
- **WHEN** `POST /api/sources` is called with a `connectorId` that exists but is owned by a
  different user
- **THEN** the response is 400 (or 404), never a successful source referencing it

#### Scenario: A credential field in the request is rejected
- **WHEN** `POST /api/sources` is called for `type: "rest_api"` with an `auth`/credential
  value present in `config`
- **THEN** the response is 400, and no DataSource is created

#### Scenario: Missing required fields returns 400
- **WHEN** `POST /api/sources` is called with no `connectorId` in config
- **THEN** the response is 400 with a descriptive error

#### Scenario: Legacy bare-url create still succeeds (dual-support)
- **NOTE**: this scenario's title is retained verbatim from the pre-existing spec for archival
  name-continuity only (`openspec validate` requires every MODIFIED requirement to carry forward
  every scenario name the baseline spec already has). Its behavior is the OPPOSITE of what the
  title says as of this change — see Decision 1.
- **WHEN** `POST /api/sources` is called with `type: "rest_api"` and only a `url` in config (no
  `connectorId`)
- **THEN** the response is 400, NOT 201 (dual-support is retired) — the error message names
  `connectorId` and directs the caller to create a Connector first, and no DataSource is created

#### Scenario: Supplying both connectorId and url is rejected
- **WHEN** `POST /api/sources` is called with `type: "rest_api"` and both `connectorId` and
  `url` present in config
- **THEN** the response is 400 with a descriptive error (both `url`'s presence at all, and the
  ambiguity of supplying both, are rejected — `url` alone is never a valid `config` shape for a
  create request after this change), and no DataSource is created

#### Scenario: A body on a GET request is rejected
- **WHEN** `POST /api/sources` is called with `method: "GET"` (or omitted, since `GET` is the
  default) and a non-empty `body` in config
- **THEN** the response is 400 with a descriptive error, and no DataSource is created

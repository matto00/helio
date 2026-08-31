## MODIFIED Requirements

_Companion DataTypes are retired (HEL-903 decision 4/11); a source's schema now lives directly on `data_sources.inferred_schema`, written by `upsertInferredSchema` in place of the old `upsertSourceDataType`/second-upsert path. Scenario titles are preserved verbatim from the live spec even where they still say "DataType" (they describe the same test case) — only the body text below each is updated to the new mechanism._

### Requirement: Create a REST/HTTP data source
The backend SHALL expose `POST /api/sources` accepting a JSON body with `name`, discriminator
`type: "rest_api"`, and a `config` object containing `connectorId` (referencing an existing
Connector owned by the same user). Optional `endpoint` (default empty), optional `method`
(default `GET`), optional `queryParams`, optional per-source `headers`, optional `body` (with
optional `bodyContentType`, default `application/json`), optional `rootSelector` (a dot-path
locating the row array/object in the response, applied by `toRows`; unset reproduces today's
top-level-array/object behavior exactly). On success it SHALL insert the DataSource, attempt an
initial fetch+inference (resolving the referenced Connector's base host and credential), and if
inference succeeds, insert a inferred schema on the source. The response SHALL include
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
  inferred schema in the registry

#### Scenario: Creation succeeds even when fetch fails
- **WHEN** `POST /api/sources` is called but the remote URL returns a 4xx/5xx or is unreachable
- **THEN** the response is 201 with the DataSource and a non-null `fetchError` field; no
  inferred schema is registered

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

### Requirement: Refresh a REST/HTTP data source
The backend SHALL expose `POST /api/sources/:id/refresh` which resolves the source's
referenced Connector, re-fetches the composed URL, re-runs schema inference, and overwrites
the source's inferred_schema fields (incrementing its version). If no inferred schema exists yet (e.g.
initial fetch failed), a new one SHALL be created.

#### Scenario: Successful refresh updates DataType fields
- **WHEN** `POST /api/sources/:id/refresh` is called and the resolved URL returns a 2xx JSON
  response
- **THEN** the response is 200 with the updated inferred schema; version is incremented by 1

#### Scenario: Refresh on non-existent source returns 404
- **WHEN** `POST /api/sources/:id/refresh` is called with an unknown id
- **THEN** the response is 404

#### Scenario: Refresh fetch failure returns 502
- **WHEN** `POST /api/sources/:id/refresh` is called but the remote request fails
- **THEN** the response is 502 with a descriptive error; existing inferred schema is unchanged

### Requirement: Preview a REST/HTTP data source
The backend SHALL expose `GET /api/sources/:id/preview` which resolves the source's referenced
Connector, fetches the composed URL, parses the JSON response, and returns the first 10 rows
as a JSON array. No DataSource or inferred schema records are created or modified.

#### Scenario: Preview returns up to 10 rows
- **WHEN** `GET /api/sources/:id/preview` is called and the resolved URL returns a JSON array
  with more than 10 elements
- **THEN** the response is 200 with a `rows` array containing exactly 10 elements

#### Scenario: Single-object response is wrapped in array
- **WHEN** `GET /api/sources/:id/preview` is called and the resolved URL returns a JSON object
  (not array)
- **THEN** the response is 200 with a `rows` array containing that single object

#### Scenario: Preview on non-existent source returns 404
- **WHEN** `GET /api/sources/:id/preview` is called with an unknown id
- **THEN** the response is 404

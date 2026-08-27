## Purpose
Defines the REST/HTTP data-source connector: creating, refreshing, and previewing a source, injecting configured authentication into outgoing requests, and redacting credentials from API responses.

## Requirements

### Requirement: Create a REST/HTTP data source
The backend SHALL expose `POST /api/sources` accepting a JSON body with `name`, discriminator
`type: "rest_api"`, and a `config` object containing **either** `connectorId` (referencing an
existing Connector owned by the same user) **or** a legacy bare `url` (dual-support, retained
for the existing "Add REST Source" UI until HEL-827 replaces it with a Connector-aware form —
never both in the same request). When `connectorId` is present: optional `endpoint` (default
empty), optional `method` (default `GET`), optional `queryParams`, optional per-source
`headers`. When legacy `url` is present instead: the system SHALL synthesize an implicit,
visibly-flagged, no-auth Connector for that request and proceed exactly as the `connectorId`
path would from that point on. On success it SHALL insert the DataSource, attempt an initial
fetch+inference (resolving the referenced or synthesized Connector's base host and
credential), and if inference succeeds, insert a DataType linked to the source. The response
SHALL include `fetchError` if the initial fetch failed. The system SHALL NOT accept a
credential or auth value directly on this request — a request containing one SHALL be
rejected (400). A request containing **both** `connectorId` and `url` SHALL be rejected (400).

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
- **WHEN** `POST /api/sources` is called with neither `connectorId` nor `url` in config
- **THEN** the response is 400 with a descriptive error

#### Scenario: Legacy bare-url create still succeeds (dual-support)
- **WHEN** `POST /api/sources` is called with `type: "rest_api"` and only a `url` in config
  (no `connectorId`), matching the existing "Add REST Source" UI's request shape
- **THEN** the response is 201, an implicit no-auth Connector is synthesized and flagged as
  such, and the created source references it

#### Scenario: Supplying both connectorId and url is rejected
- **WHEN** `POST /api/sources` is called with `type: "rest_api"` and both `connectorId` and
  `url` present in config
- **THEN** the response is 400 with a descriptive error, and no DataSource is created

### Requirement: Refresh a REST/HTTP data source
The backend SHALL expose `POST /api/sources/:id/refresh` which resolves the source's
referenced Connector, re-fetches the composed URL, re-runs schema inference, and overwrites
the linked DataType's fields (incrementing its version). If no DataType exists yet (e.g.
initial fetch failed), a new one SHALL be created.

#### Scenario: Successful refresh updates DataType fields
- **WHEN** `POST /api/sources/:id/refresh` is called and the resolved URL returns a 2xx JSON
  response
- **THEN** the response is 200 with the updated DataType; version is incremented by 1

#### Scenario: Refresh on non-existent source returns 404
- **WHEN** `POST /api/sources/:id/refresh` is called with an unknown id
- **THEN** the response is 404

#### Scenario: Refresh fetch failure returns 502
- **WHEN** `POST /api/sources/:id/refresh` is called but the remote request fails
- **THEN** the response is 502 with a descriptive error; existing DataType is unchanged

### Requirement: Preview a REST/HTTP data source
The backend SHALL expose `GET /api/sources/:id/preview` which resolves the source's referenced
Connector, fetches the composed URL, parses the JSON response, and returns the first 10 rows
as a JSON array. No DataSource or DataType records are created or modified.

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

### Requirement: Auth injection
The `RestApiConnectorDriver` SHALL inject authentication into outgoing requests based on the
auth material stored on the source's *referenced Connector*, never on the source itself.
Supported types (unchanged from the Connector's own stored shape): `none`, `bearer` (adds
`Authorization: Bearer <token>` header), `api_key` (adds a custom header or query parameter by
`name` and `value`, placement controlled by `in: "header"|"query"`).

#### Scenario: Bearer token injected as Authorization header
- **WHEN** the source's Connector has stored credential auth `{ type: "bearer", token: "abc" }`
- **THEN** the outgoing HTTP request includes `Authorization: Bearer abc`

#### Scenario: API key injected as header
- **WHEN** the source's Connector has stored credential auth `{ type: "api_key", name:
  "X-Api-Key", value: "secret", in: "header" }`
- **THEN** the outgoing HTTP request includes `X-Api-Key: secret` header

#### Scenario: API key injected as query param
- **WHEN** the source's Connector has stored credential auth `{ type: "api_key", name: "key",
  value: "secret", in: "query" }`
- **THEN** the outgoing HTTP request URL includes `?key=secret`

### Requirement: Credentials are never returned in API responses
The `DataSource` response object SHALL emit a redacted `config` payload: SQL passwords SHALL
be replaced with `"***"` before serialization. A `rest_api` source's config carries only
`connectorId`, `endpoint`, `method`, `queryParams`, and `headers` — none of which is a
credential field, so there is nothing left on a `rest_api` source's config to redact; the
credential lives solely on the referenced Connector, governed by
`connectors/connector-credential-binding`'s own no-read-path-returns-raw-credential
requirement. Non-credential fields (URL/host derived from the Connector, method, headers,
endpoint, dialect, host, database, user, query for other kinds) ARE included so the UI can
display and edit sources without round-tripping the stored config.

#### Scenario: No credential-shaped field exists on a rest_api source response
- **WHEN** `POST /api/sources`, `GET /api/sources`, or `GET /api/sources/:id/refresh` returns
  a `rest_api` source
- **THEN** the response's `config` object contains no field that ever held a credential value
  (no `auth` field of any kind — that data now lives only on the referenced Connector)

#### Scenario: SQL passwords are redacted in the create response
- **WHEN** `POST /api/sources` succeeds for a SQL source
- **THEN** the response body's `config.password` is `"***"`, not the original password

#### Scenario: Bearer tokens are redacted in the create response
- **WHEN** `POST /api/sources` succeeds for `type: "rest_api"`
- **THEN** the response body's `config` contains no `auth`/bearer-token field at all — the
  bearer-token-redaction behavior this scenario originally described is superseded by the
  field's removal from the source entirely; the equivalent guarantee (a bearer token is never
  returned by a client-facing read) is now owned by `connectors/connector-credential-binding`

#### Scenario: API-key values are redacted in the create response
- **WHEN** `POST /api/sources` succeeds for `type: "rest_api"`
- **THEN** the response body's `config` contains no `auth`/api-key field at all — the api-key-
  redaction behavior this scenario originally described is superseded by the field's removal
  from the source entirely; the equivalent guarantee is now owned by
  `connectors/connector-credential-binding`

### Requirement: Header precedence between Connector and source
The system SHALL merge the Connector's default headers with the source's own headers before
issuing a request, with the **source's** value winning on a key collision.

#### Scenario: Non-colliding headers are both applied
- **WHEN** the Connector has default header `X-Env: prod` and the source has header
  `Accept: application/json`
- **THEN** the outgoing request includes both headers

#### Scenario: Source header overrides Connector default on collision
- **WHEN** the Connector has default header `Accept: application/xml` and the source has
  header `Accept: application/json`
- **THEN** the outgoing request's `Accept` header is `application/json`

### Requirement: Pre-existing REST sources are migrated to reference a Connector
The system SHALL migrate every pre-existing `rest_api` data source (stored in the legacy
inline `url`/`auth`/`headers` shape) into the Connector-referencing shape, once, such that the
source continues to fetch successfully afterward with no data or behavior loss. The migration
SHALL be idempotent (safe to run repeatedly against the same data) and SHALL NOT silently
produce an invalid or zero-value config for a row it cannot parse.

#### Scenario: A legacy REST source is migrated and still fetches
- **GIVEN** a pre-existing `rest_api` data source stored in the legacy `url`/`auth`/`headers`
  shape
- **WHEN** the migration runs
- **THEN** a Connector is created holding that source's host and credential (encrypted), the
  source's config is rewritten to reference it, and a subsequent fetch/refresh against that
  source succeeds identically to before migration

#### Scenario: Re-running the migration is a no-op for already-migrated rows
- **WHEN** the migration runs against a source whose config already references a Connector
- **THEN** no new Connector is created and the source's config is unchanged

#### Scenario: A malformed legacy row is skipped, not corrupted
- **WHEN** the migration encounters a `rest_api` source whose stored config matches neither the
  legacy shape nor the new Connector-referencing shape
- **THEN** the row is left untouched, the failure is logged with the source id, and no
  Connector or config rewrite is produced for it

### Requirement: Infer and test-connection accept the legacy bare-url shape ephemerally
The backend SHALL accept a bare `url` (no `connectorId`) in `POST /api/sources/infer` and
`POST /api/sources/test` for `type: "rest_api"`, resolving it without persisting any Connector
— these calls never create a DataSource and SHALL NOT create a Connector as a side effect
either. A request carrying a `connectorId` SHALL be resolved against that owner-scoped
Connector instead, also without persisting anything new.

#### Scenario: Bare-url infer succeeds with no persisted side effect
- **WHEN** `POST /api/sources/infer` is called with only `url` (no `connectorId`), matching
  the existing "Preview schema" step's request shape
- **THEN** the response is 200 with the inferred schema, and no new Connector row is created

#### Scenario: Bare-url test-connection succeeds with no persisted side effect
- **WHEN** `POST /api/sources/test` is called with only `url` (no `connectorId`), matching
  the existing "Test connection" button's request shape
- **THEN** the response reflects the connection result, and no new Connector row is created

#### Scenario: connectorId-carrying infer/test resolves the real Connector
- **WHEN** `POST /api/sources/infer` or `POST /api/sources/test` is called with a
  `connectorId` referencing the caller's own Connector
- **THEN** the request is composed using that Connector's base host and credential, and no
  new Connector row is created

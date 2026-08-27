## Purpose
Defines the REST/HTTP data-source connector: creating, refreshing, and previewing a source, injecting configured authentication into outgoing requests, and redacting credentials from API responses.

## Requirements

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

### Requirement: REST source request fields support `{{name}}` templating
A `rest_api` source's `endpoint`, `queryParams` values, `headers` values, and `body` MAY
contain `{{name}}` placeholders, resolved against the source's own
`parameters: Map[String, String]` before the outbound request is issued. Resolution SHALL
apply identically whether the fetch is authoring-time (create/infer/test/refresh against a
`connectorId`-carrying request) or run-time (pipeline execution). This requirement applies only
to the `connectorId`-resolving path — a bare-`url` ephemeral request (no persisted source, no
`parameters` store) leaves `{{...}}` as literal text, unchanged, and is out of scope for this
requirement. `body`'s string content is resolved with the same JSON-string-escaping contract
already used at the interpolator level, and the resolved body IS now attached to the outbound
request as the entity, with `bodyContentType` (default `application/json`) as its content type.

#### Scenario: Endpoint, query param, and header placeholders all resolve in the built request
- **WHEN** a source's `endpoint`, a `queryParams` value, and a `headers` value each contain a
  `{{name}}` placeholder matching a key in `parameters`
- **THEN** each placeholder is replaced with its parameter's value before the request is built

#### Scenario: A source with no parameters is unaffected
- **WHEN** a source has an empty `parameters` map and no `{{...}}` syntax anywhere in its config
- **THEN** the request is built byte-identical to the pre-templating behavior

#### Scenario: A body placeholder resolves into the actual outbound request
- **WHEN** a source's `body` contains `{"q": "{{userInput}}"}` and `parameters` defines
  `userInput`
- **THEN** the outbound HTTP request carries a JSON entity with `userInput`'s value spliced in,
  verified against a real endpoint that echoes the received body

### Requirement: Unresolved template variables fail loudly on the connectorId-resolving path
For a `connectorId`-resolving fetch (authoring-time test/preview/refresh against an
already-created source, or run-time pipeline execution), a `{{name}}` placeholder with no
matching entry in the resolved parameter map SHALL cause the fetch to fail with a curated error
naming the unresolved variable, before any network request is issued. It SHALL NOT be silently
substituted with an empty string. This requirement does not apply to the bare-`url` ephemeral
path, which has no `parameters` store and leaves `{{...}}` as literal text (a separate,
already-existing behavior, unchanged by this capability).

#### Scenario: Unresolved endpoint variable
- **WHEN** `endpoint` contains `{{missingVar}}` and `parameters` has no `missingVar` entry
- **THEN** the fetch fails with an error message that names `missingVar`, and no HTTP request is
  sent

### Requirement: Template substitution is escaped per context
A substituted value SHALL NOT be able to change the structural shape of the request beyond
replacing the placeholder's own value: a query-param value cannot introduce additional query
parameters or break out of the query string; an endpoint substitution cannot introduce a new
path segment, query string, or fragment; a header value cannot inject additional headers or
control characters (CRLF); a body substitution cannot break out of its JSON string context.

#### Scenario: Query param value with an ampersand
- **WHEN** a `queryParams` value's placeholder resolves to `a&b=c`
- **THEN** the request is issued with exactly one query parameter carrying the literal value
  `a&b=c`, not two parameters

#### Scenario: Header value with CRLF is rejected
- **WHEN** a `headers` value's placeholder resolves to a string containing `\r\n`
- **THEN** the fetch fails with a curated error rather than sending a request with an injected
  header

#### Scenario: JSON body value with a quote and newline
- **WHEN** a source's `body` template's placeholder resolves to a value containing a double
  quote and a newline
- **THEN** the outbound request's entity remains valid JSON with the value's quote and newline
  properly escaped, verified against a real endpoint that echoes and re-parses the received body

#### Scenario: JSON body value with unicode and control characters
- **WHEN** a source's `body` template's placeholder resolves to a value containing a backslash,
  a control character, and non-ASCII unicode text
- **THEN** the outbound request's entity remains valid JSON with every character properly
  escaped, verified against a real endpoint that echoes and re-parses the received body

### Requirement: The Connector's decrypted credential is never an addressable template variable
The credential value decrypted for outbound auth SHALL NOT be reachable through `{{name}}`
templating under any parameter name, by construction — it is never inserted into the map
templating resolves against.

#### Scenario: A template referencing a credential-shaped variable name fails loud like any other
  unresolved variable
- **WHEN** a source's config contains `{{apiKey}}` (or `{{credential}}`, `{{secret}}`) and no
  `parameters` entry defines it
- **THEN** the fetch fails with the same unresolved-variable error as any other undefined
  placeholder — the decrypted credential value never appears in the resolved request

### Requirement: A REST source can send a request body
A `rest_api` source's `POST`/`PUT`/`PATCH` request MAY carry a `body` (a string, interpreted per
`bodyContentType`) which SHALL be sent as the outbound HTTP request's entity. `bodyContentType`
defaults to `application/json` when unset. A `body` on `GET`/`HEAD` SHALL be rejected at
create/update time (see "Create a REST/HTTP data source") rather than being silently dropped or
sent.

#### Scenario: POST body reaches a real endpoint unchanged
- **WHEN** a source configured with `method: "POST"` and a `body` fetches against a real HTTP
  endpoint that echoes its received request body
- **THEN** the echoed body matches the configured (and, if templated, resolved) body exactly

#### Scenario: Invalid bodyContentType is rejected before any request is issued
- **WHEN** a source's `bodyContentType` is not a parseable HTTP content type
- **THEN** the create/update request is rejected (400) with a descriptive error

### Requirement: Minimal response root-selector (jsonPath)
A `rest_api` source MAY declare `rootSelector`: a dot-separated path of object-key segments
(e.g. `data.items`) locating the array or object within the response body that `toRows` should
operate on. When `rootSelector` is unset, `toRows` behavior is byte-identical to the pre-existing
behavior (top-level `JsArray` → one row per element; top-level `JsObject` → one row; anything
else → one row). When set, the same array/object/other classification is applied to the value
found at the end of the path walk instead of the response root. A path segment that does not
exist, or that requires descending into a non-object value, SHALL yield zero rows (never a 500)
and SHALL be logged server-side naming the source and the failing segment. This requirement is a
deliberate strict subset of the response-shaping behavior HEL-599 will add (same dot-path
convention; no flatten, no pagination-loop composition, no curated `fetchError` envelope, no
inference-facade-specific handling) so that ticket can extend rather than rewrite this one.

#### Scenario: Row array nested under a single key
- **WHEN** a source's `rootSelector` is `data` and the response body is `{"data": [{"a": 1}]}`
- **THEN** `toRows` produces one row, `{"a": 1}`

#### Scenario: Row array nested two levels deep
- **WHEN** a source's `rootSelector` is `results.items` and the response body is
  `{"results": {"items": [{"a": 1}, {"a": 2}]}}`
- **THEN** `toRows` produces two rows

#### Scenario: Unset selector reproduces today's behavior exactly
- **WHEN** a source has no `rootSelector` and the response body is a top-level JSON array
- **THEN** `toRows` produces the same rows it would have before this requirement existed

#### Scenario: Selector pointing at a missing key yields zero rows, not an error
- **WHEN** a source's `rootSelector` is `missing.path` and the response body has no top-level
  `missing` key
- **THEN** `toRows` produces zero rows, and the failure is logged server-side (not surfaced as a
  client-visible fetch error by this requirement — see HEL-599 for a curated error envelope)

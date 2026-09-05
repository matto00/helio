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

### Requirement: Auth injection
The `RestApiConnectorDriver` SHALL inject authentication into outgoing requests based on the
auth material stored on the source's *referenced Connector*, never on the source itself.
Supported types (unchanged from the Connector's own stored shape): `none`, `bearer` (adds
`Authorization: Bearer <token>` header), `api_key` (adds a custom header or query parameter by
`name` and `value`, placement controlled by `in: "header"|"query"`).

When the API key is placed in the query, the injected pair SHALL take precedence over any
source-configured query pair of the same name: every such source pair SHALL be removed before
the credential pair is appended, so the outgoing request never carries both. This mirrors the
existing auth-header-always-wins rule and SHALL survive the change from a single-value query
map to an ordered multi-valued list -- an append that left a source-supplied pair of the same
name in place would let a source shadow the credential on any server that reads the first
occurrence.

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

#### Scenario: The injected query credential overrides a same-named source pair
- **WHEN** the Connector injects `key=secret` into the query and the source's `queryParams`
  contains `key=source-supplied`
- **THEN** the outgoing request carries `key=secret` once and does not carry
  `key=source-supplied`

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

### Requirement: Response root-selector with curated selection errors
A `rest_api` source MAY declare `rootSelector`: a dot-separated path of object-key segments
(e.g. `data.items`) locating the array or object within the response body that `toRows` should
operate on. When `rootSelector` is unset, `toRows` behavior is byte-identical to the pre-existing
behavior (top-level `JsArray` → one row per element; top-level `JsObject` → one row; anything
else → one row). When set, the same array/object/other classification is applied to the value
found at the end of the path walk instead of the response root.

A path segment that does not exist, or that requires descending into a non-object value, SHALL
produce a curated fetch error naming the selector and the failing segment, surfaced through the
`fetch-error-envelope` capability's `fetchError` field. It SHALL NOT produce a 500, and it SHALL
NOT produce a silent empty success — a caller that supplied a selector which did not match the
response is told so rather than receiving zero rows indistinguishable from a genuinely empty
result. The curated message SHALL NOT include the response body or any credential material. The
failure SHALL also be logged server-side naming the source and the failing segment.

Rows located by the selector SHALL be materialised through the shared traversal defined by the
`nested-json-flattening` capability, so a selected row containing nested objects carries dotted
columns matching its inferred schema.

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

#### Scenario: Selector pointing at a missing key yields a curated error rather than zero rows
- **WHEN** a source's `rootSelector` is `missing.path` and the response body has no top-level
  `missing` key
- **THEN** the source's `fetchError` carries a curated message naming the selector and the failing
  segment, no rows are reported as a successful empty result, and no 500 is returned

#### Scenario: Selector descending through a non-object is a curated error
- **WHEN** a source's `rootSelector` is `data.items` and the response body is `{"data": 5}`
- **THEN** the source's `fetchError` carries a curated message naming the failing segment

#### Scenario: Curated selector error leaks no response content
- **WHEN** a selector failure produces a `fetchError`
- **THEN** the message contains neither the response body nor any credential or header value

#### Scenario: Selected rows carry dotted columns for nested objects
- **WHEN** a source's `rootSelector` is `data` and the response body is
  `{"data": [{"id": 1, "stats": {"pts": 33.7}}]}`
- **THEN** the materialised row has columns `id` and `stats.pts`, and no column `stats`

### Requirement: REST fetches refuse disallowed destinations
Every outbound request issued on behalf of a REST source SHALL be governed by the shared egress policy
(`outbound-egress-guard`), regardless of which entry point issued it — a source refresh, a preview, a pipeline run, a
connection test, or a schema inference. This SHALL hold for a destination assembled from a Connector's stored base URL
and a source's endpoint as well as for a bare caller-supplied URL.

The refusal SHALL be reported on whichever error channel the entry point already uses for a failed fetch, and its
message SHALL name the disallowed address so a caller can distinguish a destination that is not permitted from one
that is merely unreachable. For a refresh, a preview, a pipeline run, or a schema inference that is a 502-class
upstream error. A connection test is the one exception: it already reports any failure as a 200 response carrying
`ok = false` and the reason in `error`, and an egress refusal is reported the same way (see
`connection-test-endpoint`).

The status code is NOT specialised for this case: the REST driver reports every failure as an untyped message, and
introducing a typed error channel would change the shared connector-driver contract and every consumer of it — out of
scope here, carried as a follow-up. The refusal at Connector create/update time is unaffected and remains a 400-class
client error.

#### Scenario: A REST source refresh targeting an internal address is refused
- **WHEN** a REST source whose resolved destination is a loopback, link-local, or private address is refreshed
- **THEN** the fetch is refused with a 502-class error whose message states the host resolves to a disallowed address
- **AND** no outbound request is issued

#### Scenario: The cloud metadata endpoint is refused
- **WHEN** a REST fetch resolves to `169.254.169.254`
- **THEN** the fetch is refused before any connection is opened

#### Scenario: A legitimate external destination still succeeds
- **WHEN** a REST source targets a reachable public HTTPS endpoint
- **THEN** the fetch succeeds and returns rows exactly as before this change
- **AND** the request still carries its configured method, headers, body, and injected credential

### Requirement: A REST redirect response is not treated as success
A 3xx response to a REST fetch SHALL be treated as a failure and its body SHALL NOT be parsed as the response payload.

#### Scenario: A 302 is reported as a failure
- **WHEN** a REST fetch receives a 302 response
- **THEN** the result is an error, not a successfully parsed body

### Requirement: Query parameters preserve repeated keys and their order
A REST source's `queryParams` SHALL be an ordered list of name/value pairs, not a single-value map.
Repeated names SHALL be preserved with every value, and the order in which the pairs were authored
SHALL be the order in which they appear in the outgoing request's query string. The wire `config`
SHALL accept `queryParams` either as a JSON array of `{"name": ..., "value": ...}` objects (the
current encoding) or as a JSON object of name-to-value (the historical encoding, decoded in
key-sorted order -- the JSON parser builds an object's fields into a `TreeMap`, so no
document-order information survives parsing for this branch to recover), and SHALL emit the array
encoding on read. Decode SHALL remain total: neither encoding, nor a malformed one, may introduce
a validation failure into the decode path.

Request composition SHALL build the outgoing query once from the endpoint's own query string
followed by the configured pairs, in that order, without collapsing on name. A query string
already carried on `endpoint` SHALL survive composition. An auth credential injected as a query
parameter SHALL be appended to the composed query rather than rebuilt from it.

`{{name}}` template resolution SHALL be applied per pair, so a templated value appearing in a
repeated name resolves at each occurrence.

Migration of a legacy full URL into a Connector-referencing source SHALL retain every query pair
that URL carried, in order.

#### Scenario: A repeated query key reaches the server with both values in order
- **WHEN** a REST source is configured with `queryParams` `[(tag, a), (tag, b)]` and fetched
- **THEN** the HTTP server receives a request whose query string contains `tag=a` before `tag=b`,
  both present

#### Scenario: Authored order is preserved across interleaved names
- **WHEN** a REST source is configured with `queryParams` `[(z, 1), (a, 2), (z, 3)]` and fetched
- **THEN** the HTTP server receives the pairs in exactly that order, not sorted and not grouped by
  name

#### Scenario: A query string on the endpoint survives composition
- **WHEN** a REST source's `endpoint` is `/search?existing=1` and its `queryParams` is `[(tag, a)]`
- **THEN** the outgoing request carries both `existing=1` and `tag=a`

#### Scenario: A templated value in a repeated key resolves per occurrence
- **WHEN** `queryParams` is `[(tag, {{first}}), (tag, {{second}})]` with `parameters` supplying both
- **THEN** the outgoing request carries both resolved values, in order

#### Scenario: A historical map-shaped persisted config still fetches identically
- **WHEN** a stored `config` blob encodes `queryParams` as a JSON object
- **THEN** it decodes without error and produces the same outgoing request it produced before this
  change

#### Scenario: An auth query credential is appended, not merged through a map
- **WHEN** a Connector places its API key in the query and the source has repeated query keys
- **THEN** the outgoing request carries every source pair plus the api-key pair

#### Scenario: A source query pair colliding with the auth parameter name is dropped
- **WHEN** a Connector injects its API key as query parameter `key`, and the source's own
  `queryParams` also contains a pair named `key`
- **THEN** the outgoing request carries only the Connector-injected `key` pair; the
  source-supplied one is dropped, never sent alongside it

#### Scenario: A malformed queryParams value fails loud rather than decoding to empty
- **WHEN** a stored `config` blob's `queryParams` is neither the array nor the object encoding
  (for example a bare string, or an array entry missing `name`)
- **THEN** `decodeRest` returns `Left("malformed: could not decode rest_api config")`, and the
  source does NOT fetch with an empty query

#### Scenario: A bare-url created source keeps the URL's query string
- **WHEN** a REST source is created with a bare `url` of `https://api.example.com/x?tag=a&tag=b`
- **THEN** the resulting source's stored config carries both `tag` pairs in order, and fetching
  it issues a request carrying both

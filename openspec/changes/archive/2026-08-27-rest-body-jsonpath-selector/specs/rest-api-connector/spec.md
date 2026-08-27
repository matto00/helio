## MODIFIED Requirements

### Requirement: Create a REST/HTTP data source
The backend SHALL expose `POST /api/sources` accepting a JSON body with `name`, discriminator
`type: "rest_api"`, and a `config` object containing **either** `connectorId` (referencing an
existing Connector owned by the same user) **or** a legacy bare `url` (dual-support, retained
for the existing "Add REST Source" UI until HEL-827 replaces it with a Connector-aware form —
never both in the same request). When `connectorId` is present: optional `endpoint` (default
empty), optional `method` (default `GET`), optional `queryParams`, optional per-source
`headers`, optional `body` (with optional `bodyContentType`, default `application/json`),
optional `rootSelector` (a dot-path locating the row array/object in the response, applied by
`toRows`; unset reproduces today's top-level-array/object behavior exactly). When legacy `url`
is present instead: the system SHALL synthesize an implicit, visibly-flagged, no-auth Connector
for that request and proceed exactly as the `connectorId` path would from that point on,
including forwarding `body`/`bodyContentType`/`rootSelector` the same way `method`/`headers`
already forward. On success it SHALL insert the DataSource, attempt an initial fetch+inference
(resolving the referenced or synthesized Connector's base host and credential), and if
inference succeeds, insert a DataType linked to the source. The response SHALL include
`fetchError` if the initial fetch failed. The system SHALL NOT accept a credential or auth
value directly on this request — a request containing one SHALL be rejected (400). A request
containing **both** `connectorId` and `url` SHALL be rejected (400). A request whose `method`
is `GET` or `HEAD` and which also supplies a non-empty `body` SHALL be rejected (400) — a body
is never silently sent on a safe method.

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

#### Scenario: A body on a GET request is rejected
- **WHEN** `POST /api/sources` is called with `method: "GET"` (or omitted, since `GET` is the
  default) and a non-empty `body` in config, for either the `connectorId` or bare-`url` path
- **THEN** the response is 400 with a descriptive error, and no DataSource is created

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

## ADDED Requirements

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

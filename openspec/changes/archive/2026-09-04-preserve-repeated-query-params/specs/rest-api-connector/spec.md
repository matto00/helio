## ADDED Requirements

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

## MODIFIED Requirements

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

## MODIFIED Requirements

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

Creating a source SHALL persist the `parameters` map the create request supplied, on every
create path that persists a source — including the internal bare-`url` create path, which
synthesizes an implicit Connector and builds the stored config itself. A create path SHALL NOT
discard `parameters` while retaining the `{{name}}` placeholders that depend on them: doing so
persists a source whose every subsequent fetch fails the unresolved-variable guard, reporting a
missing template variable rather than the discarded input that caused it. This create-time
obligation is distinct from, and does not relax, the ephemeral bare-`url` infer/test-connection
behavior above, which persists no source and still leaves `{{...}}` literal.

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

#### Scenario: A bare-`url` create persists its parameters and the placeholders then resolve
- **WHEN** a REST source is created through the internal bare-`url` path with a `parameters` map
  and `{{name}}` placeholders in its query-param and header values
- **THEN** the persisted source carries that same `parameters` map, and a subsequent fetch of
  that source reaches a real HTTP server with the placeholders resolved to their values in the
  query string and headers the server received — not with the literal placeholder text, and not
  failing the unresolved-variable guard

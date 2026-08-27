## ADDED Requirements

### Requirement: REST source request fields support `{{name}}` templating
A `rest_api` source's `endpoint`, `queryParams` values, and `headers` values MAY contain
`{{name}}` placeholders, resolved against the source's own `parameters: Map[String, String]`
before the outbound request is issued. Resolution SHALL apply identically whether the fetch is
authoring-time (create/infer/test/refresh against a `connectorId`-carrying request) or run-time
(pipeline execution). This requirement applies only to the `connectorId`-resolving path — a
bare-`url` ephemeral request (no persisted source, no `parameters` store) leaves `{{...}}` as
literal text, unchanged, and is out of scope for this requirement. `body`'s string content
supports the same `{{name}}` resolution/escaping contract at the interpolator level (see the
templating-boundary note below), but is not yet attached to any outbound request.

#### Scenario: Endpoint, query param, and header placeholders all resolve in the built request
- **WHEN** a source's `endpoint`, a `queryParams` value, and a `headers` value each contain a
  `{{name}}` placeholder matching a key in `parameters`
- **THEN** each placeholder is replaced with its parameter's value before the request is built

#### Scenario: A source with no parameters is unaffected
- **WHEN** a source has an empty `parameters` map and no `{{...}}` syntax anywhere in its config
- **THEN** the request is built byte-identical to the pre-templating behavior

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
- **WHEN** `TemplateInterpolator.resolve` is applied to a JSON-shaped `body` template whose
  placeholder resolves to a value containing a double quote and a newline
- **THEN** the resolved string remains valid JSON with the value's quote and newline properly
  escaped (this is verified at the interpolator level; `body` is not yet attached to an outbound
  request — see HEL-826)

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

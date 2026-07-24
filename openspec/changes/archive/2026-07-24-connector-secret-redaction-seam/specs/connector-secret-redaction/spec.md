## ADDED Requirements

### Requirement: Secret fields are declared once per connector wire payload
The backend SHALL define `SecretField[Config](name: String, get: Config => Option[String], set:
(Config, String) => Config)` and `HasSecrets[Config](fields: Set[SecretField[Config]])` in
`com.helio.services`. A connector's wire-payload type (e.g. `SqlSourceConfigPayload`,
`RestApiConfigPayload`) declares its secret fields by providing a single implicit `HasSecrets[Payload]`
instance in that payload type's own companion object — not by writing ad-hoc per-field redaction code
at each response-construction call site.

#### Scenario: SQL payload declares its password field
- **WHEN** `SqlSourceConfigPayload`'s companion object is inspected
- **THEN** it provides an implicit `HasSecrets[SqlSourceConfigPayload]` whose `fields` contains one
  `SecretField` for `password`

#### Scenario: REST payload declares its bearer-token and api-key fields
- **WHEN** `RestApiConfigPayload`'s companion object is inspected
- **THEN** it provides an implicit `HasSecrets[RestApiConfigPayload]` whose `fields` contains one
  `SecretField` for the bearer `auth.token` and one for the api-key `auth.value`

### Requirement: Missing declaration is a compile error, not a silent gap
`DataSourceResponse.fromDomain`'s `RestSource`/`SqlSource` cases SHALL construct the response
`config` payload via `SecretRedaction.redact(payload)`, which requires an implicit `HasSecrets[Config]`
for the payload's type. Removing a connector's `HasSecrets[Config]` instance SHALL cause a compile
failure at this call site.

#### Scenario: Redaction call site requires the declaration to compile
- **WHEN** the backend is compiled with `DataSourceResponse.fromDomain`'s REST/SQL cases calling
  `SecretRedaction.redact` on the connector's payload
- **THEN** compilation requires an implicit `HasSecrets[Payload]` instance to be in scope for each
  payload type passed to `SecretRedaction.redact`

### Requirement: SecretRedaction.redact masks declared fields via a SecretBackend
The backend SHALL define `SecretRedaction.redact[Config](config, backend: SecretBackend =
InlineSecretBackend)(implicit hs: HasSecrets[Config]): Config`, which, for each `SecretField` in
`hs.fields`, replaces the field's value with `backend.mask(value)` when `field.get(config)` returns
`Some(value)`, and leaves the config unchanged for that field when `get` returns `None`. Non-secret
fields SHALL be left untouched.

#### Scenario: A present secret field is masked
- **WHEN** `SecretRedaction.redact` is called on a config where a declared `SecretField.get` returns
  `Some(v)`
- **THEN** the returned config has that field replaced via `field.set(config, backend.mask(v))`

#### Scenario: An absent secret field is left untouched
- **WHEN** `SecretRedaction.redact` is called on a config where a declared `SecretField.get` returns
  `None`
- **THEN** the returned config is unchanged for that field

#### Scenario: Non-secret fields are never touched
- **WHEN** `SecretRedaction.redact` is called on any config
- **THEN** every field not covered by a `SecretField` declaration is identical, before and after, to
  the input config

### Requirement: SecretBackend has exactly one concrete implementation today
The backend SHALL define `trait SecretBackend { def mask(rawValue: String): String }` in
`com.helio.services`, with exactly one concrete implementation, `InlineSecretBackend`, whose `mask`
always returns `"***"`. `InlineSecretBackend`'s doc comment SHALL name the future ticket
(non-inline backends) as the owner of additional `SecretBackend` implementations. No sealed-trait
case or enum value for a non-inline backend SHALL exist without a corresponding implementation.

#### Scenario: Inline backend masks to the literal today's value
- **WHEN** `InlineSecretBackend.mask(rawValue)` is called with any non-empty string
- **THEN** it returns `"***"`

#### Scenario: No unimplemented backend case exists
- **WHEN** `SecretBackend`'s type hierarchy is inspected
- **THEN** every case/subtype that exists has a concrete implementation reachable from production
  code — there is no case that compiles but has no behavior

### Requirement: inline redaction reproduces today's exact wire output
Routing SQL/REST redaction through `SecretRedaction.redact` SHALL NOT change the on-the-wire output
for any existing scenario: SQL passwords redact to `"***"` when non-empty and are left as `""` when
empty; REST bearer tokens and api-key values redact to `"***"` whenever present (`Some`), regardless
of string content; all non-credential fields are unchanged.

#### Scenario: Empty SQL password is not spuriously redacted
- **WHEN** `DataSourceResponse.fromDomain` is called for a `SqlSource` whose `password` is `""`
- **THEN** the response `config.password` is `""`, not `"***"`

#### Scenario: Non-empty SQL password is redacted
- **WHEN** `DataSourceResponse.fromDomain` is called for a `SqlSource` whose `password` is non-empty
- **THEN** the response `config.password` is exactly `"***"`

#### Scenario: REST bearer token is redacted
- **WHEN** `DataSourceResponse.fromDomain` is called for a `RestSource` with `RestApiAuth.BearerAuth`
- **THEN** the response `config.auth.token` is exactly `"***"`

#### Scenario: REST api-key value is redacted, key name preserved
- **WHEN** `DataSourceResponse.fromDomain` is called for a `RestSource` with `RestApiAuth.ApiKeyAuth`
- **THEN** the response `config.auth.value` is exactly `"***"` and `config.auth.name` is unchanged

### Requirement: Redaction is verified against the actual serialized JSON
Test coverage for SQL/REST redaction SHALL assert against the actual JSON produced by serializing a
`DataSourceResponse` (e.g. via `.toJson`), not only against a helper function's return value —
proving the redaction seam is not bypassed between the helper and the HTTP response boundary.

#### Scenario: Serialized JSON never contains the raw secret string
- **GIVEN** a `RestSource`/`SqlSource` constructed with a known raw secret value
- **WHEN** `DataSourceResponse.fromDomain(source).toJson` is computed
- **THEN** the resulting JSON text does not contain the raw secret value anywhere, and contains
  `"***"` at the redacted field's position

### Requirement: Connector.scala documents the redaction contract
`Connector.scala`'s trait-level doc comment SHALL include a `'''Secret redaction'''` block, alongside
the existing four blocks (`'''Refresh semantics'''`, `'''ExecutionContext'''`, `'''Schema
inference'''`, `'''Fetch-error envelope'''`), documenting that a connector whose wire payload carries
secret fields declares a
`HasSecrets[Payload]` instance so `DataSourceResponse.fromDomain` redacts it automatically, without
inline fully-qualified names.

#### Scenario: Doc comment describes the redaction contract
- **WHEN** a developer reads `Connector.scala`'s trait-level doc comment
- **THEN** it includes a `'''Secret redaction'''` block naming `HasSecrets` and
  `SecretRedaction.redact`, describing that declaring a payload's secret fields is sufficient for
  automatic redaction at the response boundary

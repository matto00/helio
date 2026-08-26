## MODIFIED Requirements

### Requirement: Auth injection
The `RestApiConnectorDriver` SHALL inject authentication into outgoing requests based on the `auth` field in the config. Supported types: `none` (no auth), `bearer` (adds `Authorization: Bearer <token>` header), `api_key` (adds a custom header or query parameter by `name` and `value`, placement controlled by `in: "header"|"query"`).

#### Scenario: Bearer token injected as Authorization header
- **WHEN** the config includes `auth: { type: "bearer", token: "abc" }`
- **THEN** the outgoing HTTP request includes `Authorization: Bearer abc`

#### Scenario: API key injected as header
- **WHEN** the config includes `auth: { type: "api_key", name: "X-Api-Key", value: "secret", in: "header" }`
- **THEN** the outgoing HTTP request includes `X-Api-Key: secret` header

#### Scenario: API key injected as query param
- **WHEN** the config includes `auth: { type: "api_key", name: "key", value: "secret", in: "query" }`
- **THEN** the outgoing HTTP request URL includes `?key=secret`

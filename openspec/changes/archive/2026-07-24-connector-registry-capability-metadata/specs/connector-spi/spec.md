## MODIFIED Requirements

### Requirement: Connector capability metadata
Every `Connector[Config]` implementation SHALL expose a `metadata: ConnectorMetadata` value with
fields `kind: String`, `displayName: String`, `supportsIncremental: Boolean`, `authKind: String`, and
`requiredFields: Vector[ConnectorFieldDescriptor]` (each descriptor carrying `name: String`,
`label: String`, `secret: Boolean`, describing a required config field with no value), describing
static capabilities of the connector (not a specific config instance).

#### Scenario: SqlConnector exposes metadata
- **WHEN** `SqlConnector.metadata` is read
- **THEN** it returns a `ConnectorMetadata` with `kind == "sql"`, `supportsIncremental == false`, and
  `requiredFields` containing an entry named `password` with `secret == true`

#### Scenario: RestApiConnector exposes metadata
- **WHEN** `RestApiConnector.metadata` (the companion object's dependency-free `val`) or a
  `RestApiConnector` instance's `metadata` member (which delegates to it) is read
- **THEN** it returns a `ConnectorMetadata` with `kind == "rest_api"`, `supportsIncremental == false`,
  and `requiredFields` containing an entry named `url` with `secret == false`

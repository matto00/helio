## RENAMED Requirements

- FROM: `### Requirement: Connector.scala documents the redaction contract`
- TO: `### Requirement: ConnectorDriver.scala documents the redaction contract`

## MODIFIED Requirements

### Requirement: ConnectorDriver.scala documents the redaction contract
`ConnectorDriver.scala`'s trait-level doc comment SHALL include a `'''Secret redaction'''` block, alongside
the existing four blocks (`'''Refresh semantics'''`, `'''ExecutionContext'''`, `'''Schema
inference'''`, `'''Fetch-error envelope'''`), documenting that a connector whose wire payload carries
secret fields declares a
`HasSecrets[Payload]` instance so `DataSourceResponse.fromDomain` redacts it automatically, without
inline fully-qualified names.

#### Scenario: Doc comment describes the redaction contract
- **WHEN** a developer reads `ConnectorDriver.scala`'s trait-level doc comment
- **THEN** it includes a `'''Secret redaction'''` block naming `HasSecrets` and
  `SecretRedaction.redact`, describing that declaring a payload's secret fields is sufficient for
  automatic redaction at the response boundary

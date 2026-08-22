# Protocols — Sources

Data-source request/response protocol types, connector metadata responses, and `DataSourceConfigCodec` (per-connector-kind config JSON codec).

Holds: `ConnectorProtocol`, `DataSourceConfigCodec`, `DataSourceProtocol`, `ImageUploadProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); actual validation and orchestration live in
`services/sources/`.

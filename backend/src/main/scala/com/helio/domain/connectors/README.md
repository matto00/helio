# Connectors

The `ConnectorDriver[Config]` trait and its two implementations (`SqlConnectorDriver`,
`RestApiConnectorDriver`), plus the static `ConnectorRegistry` that lists every
supported connector kind and its field descriptors for the UI. Connectors
fetch/infer-schema/execute against an external data source given its config
type (defined in `domain/model/`).

Does NOT hold: the config case classes themselves (`SqlSourceConfig`,
`RestApiConfig`, etc. — those are data, and live in `domain/model/`), the
in-process pipeline execution engine that calls connectors
(`domain/engine/InProcessPipelineEngine`), or source-ingestion service logic
(`services/sources/`).

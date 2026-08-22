# Domain Model

Pure data: case classes, value-class ID wrappers, sealed-trait enumerations, and
the wire-adjacent types that describe dashboards, panels, data sources, data
types, pipelines, alerts, users, and the rest of the domain vocabulary
(`model.scala`, `pagination.scala`, `Panel.scala`, `DataSource.scala`,
`PipelineStep.scala`, `AssertionResult.scala`, `Mfa.scala`,
`PipelineSchemaDrift.scala`, `WorkspaceResourceType.scala`).

No behavior belongs here beyond simple, total companion helpers
(`asString`/`fromString` pairs, `apply`/`unapply`). Does NOT hold: connector
implementations (`domain/connectors/`), pipeline execution or schema-inference
logic (`domain/engine/`), or time/scheduling utilities (`domain/util/`) — those
reference types defined here but are not data themselves.

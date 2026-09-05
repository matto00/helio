## MODIFIED Requirements

### Requirement: Source schema derived from bound DataSource's registered DataType fields
Analyze SHALL derive a source schema **per root**, from that root's bound DataSource. The response SHALL
carry one source-schema entry per root, keyed by root id. Each entry SHALL name its root's data source
using the field `dataSourceName`, matching the spelling used by `PipelineRootSummaryResponse` on the
pipeline summary's `roots` array. The `source`-prefixed spelling `sourceDataSourceName` SHALL NOT appear
on any per-root response shape.

#### Scenario: A two-root pipeline analyzes both source schemas
- **WHEN** analyze is called on a pipeline with two roots bound to sources with different fields
- **THEN** the response carries a source schema for each root, keyed by that root's id

#### Scenario: Per-root entry names its data source as dataSourceName
- **WHEN** `GET /api/pipelines/:id/analyze` is called for a pipeline whose root is bound to a DataSource
  named `"Orders"`
- **THEN** the serialized JSON response body contains `sourceSchemas[0].dataSourceName` equal to `"Orders"`,
  and contains no `sourceDataSourceName` key

#### Scenario: Source DataType fields populate sourceSchema
- **WHEN** the source DataSource has a registered Output with fields `[{name: "col1", dataType: "string"}]`
- **THEN** `sourceSchema` in the analyze response is `[{name: "col1", type: "string"}]`

#### Scenario: Missing source DataType produces empty sourceSchema
- **WHEN** the source DataSource has no registered Output (no Output with matching sourceId)
- **THEN** `sourceSchema` is `[]` and the response is still 200

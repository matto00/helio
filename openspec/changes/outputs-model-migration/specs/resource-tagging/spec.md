## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: Data sources, pipelines, and DataTypes accept an optional tag at create time
`DataSourceService`, `PipelineService`, and `the pipeline/Output services` create paths SHALL accept an
optional single free-form `tag` string (max 200 chars) and persist it on the created resource.
Omitting `tag` SHALL leave it `null` and behave exactly as before this change.

#### Scenario: Creating a data source with a tag
- **WHEN** a data source is created with `tag: "news-2026-07-26"`
- **THEN** the created data source's `tag` field is `"news-2026-07-26"`

#### Scenario: Creating a resource without a tag is unaffected
- **WHEN** a data source, pipeline, or Output/node is created with no `tag` field in the request
- **THEN** the resource is created successfully with `tag: null`, identical to pre-change behavior

#### Scenario: Tag persists and is returned on reads
- **WHEN** a tagged data source, pipeline, or Output/node is fetched by id or listed
- **THEN** the response includes the `tag` value that was set at creation

### Requirement: Tag column is additive and does not affect untagged resources
The `tag` column SHALL be nullable with no default, added via a Flyway migration that does not
modify or require backfilling any existing row.

#### Scenario: Existing resources remain untagged after migration
- **WHEN** the migration adding the `tag` column is applied to a database with existing data
  sources, pipelines, and Output/nodes
- **THEN** all pre-existing rows have `tag = null` and continue to function (create/read/update/
  delete/analyze/run) exactly as before

## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: Data sources, pipelines, and DataTypes accept an optional tag at create time
`DataSourceService`, `PipelineService`, and `OutputRepository` create paths SHALL accept an
optional single free-form `tag` string (max 200 chars) and persist it on the created resource.
Omitting `tag` SHALL leave it `null` and behave exactly as before this change.

#### Scenario: Creating a data source with a tag
- **WHEN** a data source is created with `tag: "news-2026-07-26"`
- **THEN** the created data source's `tag` field is `"news-2026-07-26"`

#### Scenario: Creating a resource without a tag is unaffected
- **WHEN** a data source, pipeline, or Output is created with no `tag` field in the request
- **THEN** the resource is created successfully with `tag: null`, identical to pre-change behavior

#### Scenario: Tag persists and is returned on reads
- **WHEN** a tagged data source or pipeline is fetched by id or listed
- **THEN** the response includes the `tag` value that was set at creation

_An Output's `tag` is write-only in the shipped build: `OutputRepository.insertInternal` persists
`tag` (`OutputRepository.scala`, `domainToRow`), but the domain `Output` case class does not yet
surface a `tag` field on read — the DB column exists but is not read out
(`OutputRepository.scala`'s own doc comment), left for a later cycle if tag-scoped Output listing is
ever needed. No ticket is currently filed for that read-side follow-up._

### Requirement: Tag column is additive and does not affect untagged resources
The `tag` column SHALL be nullable with no default, added via a Flyway migration that does not
modify or require backfilling any existing row.

#### Scenario: Existing resources remain untagged after migration
- **WHEN** the migration adding the `tag` column is applied to a database with existing data
  sources, pipelines, and Outputs
- **THEN** all pre-existing rows have `tag = null` and continue to function (create/read/update/
  delete/analyze/run) exactly as before

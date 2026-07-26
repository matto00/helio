# resource-tagging Specification

## Purpose
Lets an agentic workflow group the data sources, pipelines, and DataTypes it creates under a
single free-form tag, set at create time and returned on reads, so the group can be discovered
and filtered without relying on naming conventions.
## Requirements
### Requirement: Data sources, pipelines, and DataTypes accept an optional tag at create time
`DataSourceService`, `PipelineService`, and `DataTypeService` create paths SHALL accept an
optional single free-form `tag` string (max 200 chars) and persist it on the created resource.
Omitting `tag` SHALL leave it `null` and behave exactly as before this change.

#### Scenario: Creating a data source with a tag
- **WHEN** a data source is created with `tag: "news-2026-07-26"`
- **THEN** the created data source's `tag` field is `"news-2026-07-26"`

#### Scenario: Creating a resource without a tag is unaffected
- **WHEN** a data source, pipeline, or DataType is created with no `tag` field in the request
- **THEN** the resource is created successfully with `tag: null`, identical to pre-change behavior

#### Scenario: Tag persists and is returned on reads
- **WHEN** a tagged data source, pipeline, or DataType is fetched by id or listed
- **THEN** the response includes the `tag` value that was set at creation

### Requirement: Resources can be listed filtered by tag
`GET /api/data-sources`, `GET /api/pipelines`, and `GET /api/types` SHALL accept an optional
`tag` query parameter that restricts results to resources owned by the caller whose `tag`
exactly matches the given value.

#### Scenario: Filtering data sources by tag returns exactly the tagged set
- **WHEN** `GET /api/data-sources?tag=news-2026-07-26` is called
- **THEN** only data sources owned by the caller with `tag == "news-2026-07-26"` are returned

#### Scenario: Filtering by a tag with no matches returns an empty list
- **WHEN** `GET /api/pipelines?tag=nonexistent` is called and no owned pipeline carries that tag
- **THEN** an empty list is returned (not an error)

#### Scenario: Tag filtering is owner-scoped
- **WHEN** user A calls `GET /api/data-sources?tag=T` and user B (not A) owns a data source tagged `T`
- **THEN** user B's data source is not included in user A's response

### Requirement: Tag column is additive and does not affect untagged resources
The `tag` column SHALL be nullable with no default, added via a Flyway migration that does not
modify or require backfilling any existing row.

#### Scenario: Existing resources remain untagged after migration
- **WHEN** the migration adding the `tag` column is applied to a database with existing data
  sources, pipelines, and DataTypes
- **THEN** all pre-existing rows have `tag = null` and continue to function (create/read/update/
  delete/analyze/run) exactly as before


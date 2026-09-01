## MODIFIED Requirements

### Requirement: create_pipeline accepts an inline source spec or an existing sourceId
`create_pipeline` SHALL accept either an existing `sourceId` or an inline source specification in
the same call, calling `POST /api/pipelines` once regardless of which form is used.

#### Scenario: Agent creates a pipeline from an inline source with no prior create_data_source call
- **WHEN** an agent calls `create_pipeline` with an inline source spec instead of a `sourceId`
- **THEN** the tool issues one `POST /api/pipelines` call that creates the source and the pipeline
  together, returning both

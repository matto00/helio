## MODIFIED Requirements

### Requirement: create_pipeline single-call tool
`create_pipeline` SHALL accept a non-empty `roots` array in place of the singular `source` object. Each element SHALL be either an existing caller-owned `sourceId` or an inline new-source spec, never both and never neither, as the singular `source` required. The tool description SHALL state that a step with no `parentStepId` attaches to a named root, and SHALL NOT describe a pipeline as having one raw source.

#### Scenario: One call builds a two-root pipeline
- **WHEN** `create_pipeline` is called with two roots, a lane under each, and a rejoin `join` consuming the second lane
- **THEN** one pipeline is created with both roots, both lanes, and the rejoin

#### Scenario: A singular source argument is rejected
- **WHEN** `create_pipeline` is called with a `source` object and no `roots`
- **THEN** the call fails with a named error and creates nothing

#### Scenario: Agent builds a pipeline with steps and outputs in one call, via an existing source
- **WHEN** an agent calls `create_pipeline` with a `sourceId`, a `steps` array containing a step
  with `parentStepId` referencing an earlier step, and an `outputs` array
- **THEN** the tool issues one `POST /api/pipelines` call and returns the created pipeline with its
  steps and outputs

#### Scenario: Agent builds a pipeline from an inline source spec in one tool call
- **WHEN** an agent calls `create_pipeline` with an inline source spec instead of `sourceId`
- **THEN** the tool creates the source via `POST /api/data-sources`, then the pipeline via
  `POST /api/pipelines` using that source's id, returning both as if from a single call

#### Scenario: Pipeline creation fails after an inline source was already created
- **WHEN** the `POST /api/pipelines` call fails after `create_pipeline` already created an inline
  source
- **THEN** the tool's error response includes the orphaned data source's id so it can be cleaned
  up


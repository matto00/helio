## ADDED Requirements

### Requirement: Analyze projects a schema per node, including every tail
`PipelineAnalyzeService` SHALL compute a projected output schema (array of `{ name, type }`,
canonical `DataFieldType` values only) for every node in the pipeline's tree — the trunk's final
step and every tail's final step — not only the pipeline's single terminal step. This projection
SHALL be the schema `GET /api/pipelines/:id/capabilities?stepId=` evaluates `OutputBindingSpec`
against.

#### Scenario: A pipeline with one tail has two node projections
- **WHEN** `GET /api/pipelines/:id/analyze` is called on a pipeline with a trunk and one tail
  branching from it
- **THEN** the response includes a projected schema for the trunk's final step and a separate
  projected schema for the tail's final step

#### Scenario: Per-node projection reflects that node's own step chain only
- **WHEN** a tail applies a `select` step dropping a column present on the trunk
- **THEN** the tail's node projection excludes that column while the trunk's projection still
  includes it

## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: Dry analyze endpoint for a pipeline proposal
`POST /api/pipelines/analyze-proposal` SHALL accept a `PipelineProposal` request body and return the
projected source schema, per-step input/output schema, and any per-step validation errors, without
persisting a source, pipeline, or step, and without running the pipeline.

#### Scenario: A valid proposal with an existing source returns projected output columns
- **WHEN** a `PipelineProposal` referencing an existing, accessible `sourceId` and a `steps` array is
  posted to `/api/pipelines/analyze-proposal`
- **THEN** the response includes the source schema and each step's projected input/output schema,
  and no data source, pipeline, or pipeline step row is created

#### Scenario: A step with an invalid config surfaces a per-step validation error, not a 500
- **WHEN** a proposal's `steps` array includes an entry whose `config` is invalid for its `type`
- **THEN** the response is `200`, that step's `validationError` field is populated, and its output
  schema falls back to its input schema (matching the existing live-analyze identity-fallback rule)

#### Scenario: A structurally invalid proposal is rejected with 400
- **WHEN** the request body omits a `PipelineProposal`-required field (`pipelineName`, `source`,
  `outputDataTypeName`, or `steps`)
- **THEN** the endpoint returns `400`

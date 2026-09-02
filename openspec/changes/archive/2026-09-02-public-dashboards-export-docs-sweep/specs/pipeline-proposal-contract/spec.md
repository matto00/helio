## MODIFIED Requirements

### Requirement: PipelineProposal schema shape
`schemas/pipelines/pipeline-proposal.schema.json` SHALL define a `PipelineProposal` object requiring
`pipelineName`, `source`, `outputDataTypeName`, and `steps`, carrying no id fields for any
resource — no `sourceId`-for-a-new-source, no `pipelineId`, no `stepId`, no output `outputId`.

#### Scenario: A minimal valid proposal validates
- **WHEN** a JSON document supplies `pipelineName`, a `source` referencing an existing `sourceId`,
  `outputDataTypeName`, and an empty `steps` array
- **THEN** the document validates against `schemas/pipelines/pipeline-proposal.schema.json`

#### Scenario: A proposal missing a required top-level field is rejected
- **WHEN** a JSON document omits `outputDataTypeName`
- **THEN** the document fails validation against `schemas/pipelines/pipeline-proposal.schema.json`


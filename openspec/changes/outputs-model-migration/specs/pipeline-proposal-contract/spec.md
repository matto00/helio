## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: PipelineProposal schema shape
`schemas/pipelines/pipeline-proposal.schema.json` SHALL define a `PipelineProposal` object requiring
`pipelineName`, `source`, `outputOutput/nodeName`, and `steps`, carrying no id fields for any
resource — no `sourceId`-for-a-new-source, no `pipelineId`, no `stepId`, no output `dataTypeId`.

#### Scenario: A minimal valid proposal validates
- **WHEN** a JSON document supplies `pipelineName`, a `source` referencing an existing `sourceId`,
  `outputOutput/nodeName`, and an empty `steps` array
- **THEN** the document validates against `schemas/pipelines/pipeline-proposal.schema.json`

#### Scenario: A proposal missing a required top-level field is rejected
- **WHEN** a JSON document omits `outputOutput/nodeName`
- **THEN** the document fails validation against `schemas/pipelines/pipeline-proposal.schema.json`

### Requirement: Backend protocol round-trips the schema, tolerating absent optionals
The backend SHALL provide `PipelineProposal`/`PipelineProposalSource` case classes and a
`RootJsonFormat[PipelineProposal]` (in `PipelineProposalProtocol`, mixed into `JsonProtocols`) that:
reads a JSON document missing any optional field without error, treating the field as absent rather
than raising a deserialization error; and, on write, omits keys for absent `Option` fields rather
than emitting a `null` value — matching `DashboardProposalProtocol`'s existing tolerant-reader
convention.

#### Scenario: Round-trip a proposal referencing an existing source
- **WHEN** a `PipelineProposal` with `source = PipelineProposalSource(sourceId = Some("src-1"), ...)`
  and one step is serialized to JSON and read back
- **THEN** the deserialized value equals the original

#### Scenario: Round-trip a proposal with an inline source
- **WHEN** a `PipelineProposal` with an inline `sqlConfig`-populated `PipelineProposalSource` and no
  `sourceId` is serialized to JSON and read back
- **THEN** the deserialized value equals the original

#### Scenario: Reading tolerates every optional field being absent
- **WHEN** a JSON object supplies only the required fields (`pipelineName`, `source`,
  `outputOutput/nodeName`, `steps`) with every source-level optional field omitted
- **THEN** `PipelineProposal`'s reader succeeds, populating the omitted fields as `None`

#### Scenario: Steps reuse the existing CreatePipelineStepRequest shape
- **WHEN** a `PipelineProposal`'s `steps` field is serialized
- **THEN** each entry's wire shape is identical to `CreatePipelineStepRequest`'s existing
  `{type, config}` format, with no separate step DTO introduced

# pipeline-proposal-contract Specification

## Purpose
Defines `PipelineProposal`, an id-free, unapplied artifact describing an (optionally new) data
source, an ordered list of transform steps, and an output DataType contract — the data-layer
counterpart to the existing `DashboardProposal` pattern, and the foundation the analyze-before-apply
and atomic-apply work (HEL-342) builds on.
## Requirements
### Requirement: PipelineProposal schema shape
`schemas/pipelines/pipeline-proposal.schema.json` SHALL define a `PipelineProposal` object requiring
`pipelineName`, `source`, `outputDataTypeName`, and `steps`, carrying no id fields for any
resource — no `sourceId`-for-a-new-source, no `pipelineId`, no `stepId`, no output `dataTypeId`.

#### Scenario: A minimal valid proposal validates
- **WHEN** a JSON document supplies `pipelineName`, a `source` referencing an existing `sourceId`,
  `outputDataTypeName`, and an empty `steps` array
- **THEN** the document validates against `schemas/pipelines/pipeline-proposal.schema.json`

#### Scenario: A proposal missing a required top-level field is rejected
- **WHEN** a JSON document omits `outputDataTypeName`
- **THEN** the document fails validation against `schemas/pipelines/pipeline-proposal.schema.json`

### Requirement: Source is an existing reference or an inline spec
The schema's `source` object SHALL support two forms: a reference to an existing data source via
`sourceId`, or an inline new-source spec via `type` (one of `csv`, `rest_api`, `sql`, `static`),
`name`, and a per-type `config` object. The schema SHALL NOT require that exactly one form is used —
resolving which branch wins when both are present is an apply-time concern outside this contract.

#### Scenario: Existing-source form validates
- **WHEN** `source` supplies only `sourceId`
- **THEN** the document validates

#### Scenario: Inline-source form validates
- **WHEN** `source` supplies `type: "sql"`, a `name`, and a `config` object
- **THEN** the document validates

### Requirement: Steps are an ordered type/config list
`steps` SHALL be an ordered array of objects, each requiring `type` (a non-empty string identifying
a pipeline step kind) and `config` (an object), mirroring the `add_pipeline_step` MCP tool's
`{type, config}` contract. The schema SHALL NOT enumerate a closed set of `type` values — the
backend's step-kind registry is the authoritative allow-list, checked at apply time, not by this
schema.

#### Scenario: A step missing `config` is rejected
- **WHEN** a `steps` entry supplies `type` but omits `config`
- **THEN** the document fails validation

#### Scenario: An unrecognized step `type` string still validates against the schema
- **WHEN** a `steps` entry supplies an arbitrary non-empty `type` string and a `config` object
- **THEN** the document validates against the schema (kind validity is an apply-time backend check,
  not a schema-level constraint)

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
  `outputDataTypeName`, `steps`) with every source-level optional field omitted
- **THEN** `PipelineProposal`'s reader succeeds, populating the omitted fields as `None`

#### Scenario: Steps reuse the existing CreatePipelineStepRequest shape
- **WHEN** a `PipelineProposal`'s `steps` field is serialized
- **THEN** each entry's wire shape is identical to `CreatePipelineStepRequest`'s existing
  `{type, config}` format, with no separate step DTO introduced


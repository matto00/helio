## ADDED Requirements

### Requirement: PipelineProposal schema describes steps and outputs
The `PipelineProposal` schema SHALL describe a proposed pipeline as steps (with `parentStepId` for
tree shape) and outputs (with `fieldMapping` targeting a specific node), replacing the prior
DataType-oriented shape.

#### Scenario: A proposal with a tail-targeted Output validates
- **WHEN** a `PipelineProposal` includes an Output whose `fieldMapping` targets a non-trunk step
- **THEN** the schema accepts the proposal and downstream validation grounds that Output against
  the projected schema at its target step

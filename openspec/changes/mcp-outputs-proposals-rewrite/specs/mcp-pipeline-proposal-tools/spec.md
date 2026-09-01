## MODIFIED Requirements

### Requirement: Pipeline proposal tools operate on Outputs, not DataTypes
Every MCP tool that reads or writes a `PipelineProposal` SHALL use the Output-oriented pipeline
proposal schema (steps + outputs), grounding each Output's `fieldMapping` against the projected
schema at its target node, not the pipeline trunk.

#### Scenario: Proposal tool grounds an Output on a tail against that tail's schema
- **WHEN** an agent submits a pipeline proposal containing an Output whose `stepId` targets a
  non-trunk tail
- **THEN** the tool validates that Output's `fieldMapping` against the projected schema computed
  at that specific tail node, not the trunk's schema

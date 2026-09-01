## ADDED Requirements

### Requirement: Proposal analysis grounds each Output at its own node
Pipeline proposal analysis SHALL call `PipelineAnalyzeService` at each proposed Output's specific
target node (not the pipeline trunk) to validate that Output's `fieldMapping` against the schema
actually available there.

#### Scenario: Analysis rejects a fieldMapping invalid at its target node even if valid at the trunk
- **WHEN** a proposed Output's `fieldMapping` references a field present at the trunk but absent
  at its target tail node
- **THEN** proposal analysis reports that Output's mapping as invalid

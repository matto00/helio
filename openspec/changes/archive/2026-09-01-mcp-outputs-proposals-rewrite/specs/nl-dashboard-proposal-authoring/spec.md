## ADDED Requirements

### Requirement: Combined dashboard proposals reference outputs and placements
A `DashboardProposal` produced by NL authoring SHALL reference proposed Outputs and their
dashboard placements, not DataType bindings.

#### Scenario: NL authoring proposes a dashboard backed by new Outputs
- **WHEN** a natural-language authoring request results in a combined proposal
- **THEN** the resulting `DashboardProposal` describes placements referencing the proposal's
  proposed Outputs, with no DataType-binding fields present

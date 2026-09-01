## MODIFIED Requirements

### Requirement: Placement creation accepts a batch of Outputs in one call
The placement-creation path underlying `place_outputs` SHALL accept an array of
`{outputId, title?, w?, h?}` entries and create one panel placement per entry.

#### Scenario: Batch placement creates multiple panels from one call
- **WHEN** `place_outputs` is called with three `{outputId}` entries for the same dashboard
- **THEN** three panels are created, each placing the corresponding Output

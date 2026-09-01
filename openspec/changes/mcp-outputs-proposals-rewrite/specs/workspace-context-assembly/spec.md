## MODIFIED Requirements

### Requirement: WorkspaceContextService is split by resource without altering column-statistics math
`WorkspaceContextService` SHALL be organized as resource-scoped modules (e.g. sources, pipelines,
outputs) while its `asNumeric` single-exit-filter structure and `BigDecimal.setScale` rounding
behavior remain byte-for-byte unchanged from before the split.

#### Scenario: Column statistics are unchanged after the service split
- **WHEN** the same fixture data is run through `WorkspaceContextService` before and after its
  decomposition into resource-scoped modules
- **THEN** the computed numeric column statistics are identical

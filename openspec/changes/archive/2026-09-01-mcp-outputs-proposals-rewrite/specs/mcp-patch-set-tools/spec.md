## ADDED Requirements

### Requirement: Patch-set tools operate on nodes, outputs, and placements
Every MCP patch-set tool (create/apply/rollback/preview) SHALL use the node/output/placement
patch-set schema, and rollback/recreate of a `PipelineStep` patch SHALL preserve that step's
`enabled` field exactly as it was before the patch, never defaulting it (HEL-766).

#### Scenario: Rolling back a step patch preserves enabled
- **WHEN** an agent applies a patch-set that modifies a `PipelineStep` and then rolls it back
- **THEN** the step's `enabled` field after rollback exactly matches its value before the patch
  was applied

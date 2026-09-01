## MODIFIED Requirements

### Requirement: Patch-set preview shows Output-level diffs
Previewing an unapplied patch-set SHALL show its effect at the level of Outputs and placements
(added/removed/modified), not DataType/panel-binding diffs.

#### Scenario: Previewing a patch-set shows an Output being added
- **WHEN** a patch-set adding a new Output to an existing pipeline is previewed before apply
- **THEN** the preview shows that Output as an addition, including its target node and
  `fieldMapping`

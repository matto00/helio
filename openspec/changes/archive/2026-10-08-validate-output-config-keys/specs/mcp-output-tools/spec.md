## ADDED Requirements

### Requirement: Output config write tools document the known-key set and aggregation shapes
The helio-mcp tools that write an Output's `config` (`add_output`, `update_output`, `create_pipeline`, any
pipeline-proposal tool that carries Output config, and `apply_patch_set` for its `output` update edits) SHALL document, in the description text the agent sees, the
per-kind known config keys, the chart `{ groupBy, agg, yField }` and metric `{ agg }` (with `fieldMapping.value`) or `{ value, agg }` aggregation shapes, and
that an unknown key or malformed aggregation is rejected with 400 naming the key. No tool description SHALL claim a
deep merge of `legend`, `tooltip`, `seriesColors` or `axisLabels`.

#### Scenario: Tool description lists the keys
- **WHEN** the `update_output` tool's description is read
- **THEN** it lists the per-kind known config keys and both aggregation shapes, and does not mention a legend/tooltip
  deep merge

#### Scenario: apply_patch_set documents Output-edit keys
- **WHEN** the `apply_patch_set` tool's description is read
- **THEN** its `output` edit `patch.config` guidance lists the per-kind known config keys and states unknown keys are
  rejected with 400

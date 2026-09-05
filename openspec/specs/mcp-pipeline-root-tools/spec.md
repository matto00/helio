# mcp-pipeline-root-tools Specification

## Purpose
The `add_root` and `remove_root` MCP tools, letting an agent extend or shrink a pipeline's set of source roots, with the same ownership checks and placement-count reporting the HTTP routes apply.. Update Purpose after archive.

## Requirements

### Requirement: add_root MCP tool
`add_root` SHALL append a root to an existing caller-owned pipeline, accepting either an existing `sourceId` or an inline source spec. The new root's source SHALL be ownership-checked; an unreadable source SHALL fail with a not-found error and change nothing.

When the inline source spec is a `rest_api` root, its `restConfig.queryParams` SHALL accept BOTH
the ordered array encoding — a JSON array of `{"name": ..., "value": ...}` objects, preserving
duplicate names and authored order — and the legacy JSON object encoding. The array encoding SHALL
be forwarded to the backend unchanged and in the authored order, so a repeated query key is
expressible when a REST source is created inline as a pipeline root, exactly as it is when the
source is created standalone. The object encoding SHALL continue to be accepted and forwarded
unchanged.

#### Scenario: add_root appends an empty lane
- **WHEN** `add_root` is called on a single-root pipeline with a readable source
- **THEN** the pipeline reports two roots and the new root has no steps

#### Scenario: add_root with an unreadable source changes nothing
- **WHEN** `add_root` names a source owned by another user
- **THEN** the call fails with a not-found error and the pipeline still has one root

#### Scenario: An inline REST root authors a repeated query key
- **WHEN** an inline `rest_api` root is created with `restConfig.queryParams`
  `[{"name":"tag","value":"a"},{"name":"tag","value":"b"}]`
- **THEN** the request sent to the backend carries both `tag` entries in that order, rather than
  collapsing them to a single value

#### Scenario: An inline REST root preserves authored order
- **WHEN** an inline `rest_api` root is created with an array `restConfig.queryParams` whose names
  are in a deliberately non-alphabetical order
- **THEN** the request sent to the backend carries those pairs in the authored order, not sorted
  by name

### Requirement: remove_root MCP tool
`remove_root` SHALL remove a root by id, deleting its lanes, their Outputs, and those Outputs' placements, and SHALL report the placement count. It SHALL refuse to remove the last remaining root, and SHALL refuse when a surviving lane references a node that would be deleted.

#### Scenario: remove_root reports the placement count it removed
- **WHEN** `remove_root` removes a root whose lane carries an Output placed on two dashboards
- **THEN** the result reports a placement count of two

#### Scenario: remove_root refuses the last root
- **WHEN** `remove_root` is called on a single-root pipeline
- **THEN** the call fails with a named error and the root remains

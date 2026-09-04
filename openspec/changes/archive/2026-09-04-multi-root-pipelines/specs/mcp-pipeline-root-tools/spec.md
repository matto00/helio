## ADDED Requirements

### Requirement: add_root MCP tool
`add_root` SHALL append a root to an existing caller-owned pipeline, accepting either an existing `sourceId` or an inline source spec. The new root's source SHALL be ownership-checked; an unreadable source SHALL fail with a not-found error and change nothing.

#### Scenario: add_root appends an empty lane
- **WHEN** `add_root` is called on a single-root pipeline with a readable source
- **THEN** the pipeline reports two roots and the new root has no steps

#### Scenario: add_root with an unreadable source changes nothing
- **WHEN** `add_root` names a source owned by another user
- **THEN** the call fails with a not-found error and the pipeline still has one root

### Requirement: remove_root MCP tool
`remove_root` SHALL remove a root by id, deleting its lanes, their Outputs, and those Outputs' placements, and SHALL report the placement count. It SHALL refuse to remove the last remaining root, and SHALL refuse when a surviving lane references a node that would be deleted.

#### Scenario: remove_root reports the placement count it removed
- **WHEN** `remove_root` removes a root whose lane carries an Output placed on two dashboards
- **THEN** the result reports a placement count of two

#### Scenario: remove_root refuses the last root
- **WHEN** `remove_root` is called on a single-root pipeline
- **THEN** the call fails with a named error and the root remains

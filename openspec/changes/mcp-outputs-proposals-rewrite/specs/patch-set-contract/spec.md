## MODIFIED Requirements

### Requirement: Patch-set operations target nodes, outputs, and placements
The patch-set schema SHALL express add/remove/modify operations against pipeline nodes, Outputs,
and dashboard placements, replacing the prior DataType/panel-binding operation shapes.

#### Scenario: A patch-set entry modifies an Output's fieldMapping
- **WHEN** a patch-set contains an operation modifying an existing Output's `fieldMapping`
- **THEN** the schema accepts the operation and its inverse is derivable for rollback

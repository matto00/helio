## ADDED Requirements

### Requirement: Applying and undoing Output creates with refs
Applying a patch set SHALL create each `output` create edit's Output in order, substitute its id for every later
`"$ref:<ref>"` that names it, and roll back every edit of the set if any edit fails; undoing the patch set SHALL delete
the created Outputs and panels.

#### Scenario: Apply then undo
- **WHEN** a patch set with an output create and a panel create bound by ref is applied and then undone
- **THEN** after apply the panel's config.outputId is the new Output's id, and after undo neither exists

#### Scenario: Mapped column missing at the node
- **WHEN** an output create maps a column that is not in its node's schema
- **THEN** preview and apply both fail with an error naming the column and the node, and nothing is written

#### Scenario: Output create on a node edited in the same set
- **WHEN** a patch set updates a step and also creates an Output at that step or a step downstream of it
- **THEN** preview fails naming the output create edit, and nothing is written

## MODIFIED Requirements

### Requirement: Ineligible nodes are greyed with a stated reason
The picker SHALL list every node in the pipeline other than the configuring step itself, and SHALL render
a node the engine or the backend would reject as disabled with a visible reason. The step's own ancestors, and
every step that already depends on it through parent or lane links (its dependents), SHALL be disabled with a
cycle reason; the step itself SHALL NOT be offered. When a save is nevertheless rejected, the backend's message
SHALL be shown on the step card, and the edit SHALL NOT be silently lost.

#### Scenario: An ancestor is greyed
- **WHEN** the picker is opened on a step whose ancestor chain contains node `a`
- **THEN** `a` is listed but disabled, with a visible reason stating that selecting it would form a cycle

#### Scenario: A dependent is greyed
- **WHEN** the picker is opened on a step that has a descendant `g`, or a step `x` whose lane input names `g`
- **THEN** `g` and `x` are listed but disabled, with a visible reason stating that selecting them would form a cycle

#### Scenario: The step itself is absent
- **WHEN** the picker is opened on step `c`
- **THEN** `c` does not appear as a selectable or disabled option

#### Scenario: A non-ancestor node in any lane is selectable
- **WHEN** the picker is opened on step `c` and node `b` is neither `c`, an ancestor of `c`, nor a dependent of `c`
- **THEN** `b` is offered as an enabled option, whether or not `b` is its lane's terminal step, and whether
  or not `b` is already consumed by another rejoin

#### Scenario: A rejected save shows the backend's message
- **WHEN** saving a union, lookup or join step's secondary input is rejected with a 400
- **THEN** the backend's message is shown on the step card

### Requirement: The picker imposes no ordering restriction
The picker SHALL NOT restrict selection by a node's lane index, row, or position relative to the
configuring step. Any node that is not the step itself, not one of its ancestors and not one of its dependents
SHALL be selectable.

#### Scenario: A node laid out to the right is selectable
- **WHEN** node `b` sits in a lane with a higher column index than the configuring step's lane
- **THEN** `b` is offered as an enabled option

#### Scenario: A node laid out below is selectable
- **WHEN** node `b` sits at a row below the configuring step and is not one of its ancestors or dependents
- **THEN** `b` is offered as an enabled option

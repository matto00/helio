## MODIFIED Requirements

### Requirement: Ineligible nodes are greyed with a stated reason
The picker SHALL list every node in the pipeline other than the configuring step itself, and SHALL render
a node the engine would reject as disabled with a visible reason. The step's own ancestors, its descendants,
and every node that depends on it through a chain of parent and `lane` links SHALL be disabled with a cycle
reason; the step itself SHALL NOT be offered.

#### Scenario: An ancestor is greyed
- **WHEN** the picker is opened on a step whose ancestor chain contains node `a`
- **THEN** `a` is listed but disabled, with a visible reason stating that selecting it would form a cycle

#### Scenario: A descendant is greyed
- **WHEN** the picker is opened on step `c` and node `d` is a descendant of `c`
- **THEN** `d` is listed but disabled, with a visible reason stating that selecting it would form a cycle

#### Scenario: A lane-linked dependent is greyed
- **WHEN** the picker is opened on step `c` and node `x` is not a descendant of `c` but has a `lane`-kind secondary input naming a descendant of `c`
- **THEN** `x` is listed but disabled, with a visible reason stating that selecting it would form a cycle

#### Scenario: The step itself is absent
- **WHEN** the picker is opened on step `c`
- **THEN** `c` does not appear as a selectable or disabled option

#### Scenario: A non-ancestor node in any lane is selectable
- **WHEN** the picker is opened on step `c` and node `b` is neither `c`, nor an ancestor of `c`, nor a node that depends on `c`
- **THEN** `b` is offered as an enabled option, whether or not `b` is its lane's terminal step, and whether
  or not `b` is already consumed by another rejoin

### Requirement: The picker imposes no ordering restriction
The picker SHALL NOT restrict selection by a node's lane index, row, or position relative to the
configuring step. Any node that is not the step itself, not one of its ancestors, and not a node that depends
on it SHALL be selectable.

#### Scenario: A node laid out to the right is selectable
- **WHEN** node `b` sits in a lane with a higher column index than the configuring step's lane, and `b` does not depend on the configuring step
- **THEN** `b` is offered as an enabled option

#### Scenario: A node laid out below is selectable
- **WHEN** node `b` sits at a row below the configuring step, is not one of its ancestors, and does not depend on it
- **THEN** `b` is offered as an enabled option

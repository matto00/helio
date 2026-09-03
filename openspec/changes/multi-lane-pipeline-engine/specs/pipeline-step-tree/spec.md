## MODIFIED Requirements

### Requirement: Position orders siblings, not the whole pipeline
`position` SHALL order a node's siblings relative to one another and SHALL serve as the deterministic tiebreak for evaluation order. It SHALL NOT constrain graph shape: a node MAY have any number of step children, and two siblings MAY share a position. No layer SHALL reject a graph on the grounds of how many children a node has or what positions they occupy.

#### Scenario: Two children at the same position are accepted
- **WHEN** a step is created with a `parentStepId` naming a node that already has a child at that position
- **THEN** the step is created successfully
- **THEN** both children are returned as children of that node

#### Scenario: Siblings are ordered by ascending position
- **WHEN** a node has three children at positions 0, 1 and 2
- **THEN** tree-ordered reads return them in that order

#### Scenario: A migrated trunk's positions are left unchanged
- **WHEN** the migration backfills `parent_step_id` for an existing pipeline
- **THEN** it does not rewrite any step's `position` value

### Requirement: The repository exposes tree-ordered reads
The system SHALL provide `childrenOf` (every child of a node, in ascending sibling-`position` order) and `tailsOf` reads over the step graph. `trunkOf` (the position-0 chain from the root) SHALL be retained only as the UI-facing notion of a primary chain and SHALL NOT be relied on by the engine, which walks the graph topologically. No tree-ordered read SHALL raise a structural error on encountering more than one child at a given position, and none SHALL silently select or drop a child. The `InvalidGraph` guard previously raised during traversal on a second `position = 0` child is removed; removing it SHALL NOT reintroduce the silent first-match selection that guard was added to prevent.

#### Scenario: trunkOf preserves pre-migration order
- **WHEN** `trunkOf` is called against a migrated pipeline
- **THEN** it returns the steps in the exact order they held before migration

#### Scenario: All children of a multi-child node are returned
- **WHEN** `childrenOf` is called on a node with three children
- **THEN** all three are returned, in ascending sibling-position order
- **THEN** no error is raised and no child is omitted

#### Scenario: Two children at position 0 are both returned
- **WHEN** `childrenOf` is called on a node with two children both at `position = 0`
- **THEN** both are returned, neither is silently dropped, and no `InvalidGraph` error is raised


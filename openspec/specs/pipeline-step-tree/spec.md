# pipeline-step-tree Specification

## Purpose
Pipeline steps form a tree (trunk plus leaf tails) rather than a flat list, so a
node can carry both the main linear chain and short side chains ending in an
Output.

## Requirements

### Requirement: A step records its parent step
The system SHALL persist `pipeline_steps.parent_step_id`, nullable, where NULL
means the step is a child of the pipeline's source root.

#### Scenario: Migrated trunk has no branching
- **WHEN** an existing (pre-migration) pipeline's steps are backfilled with
  `parent_step_id` from their prior `position` order
- **THEN** the result is a pure trunk — each step has exactly one child, in the
  original order

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

### Requirement: Deleting a step splices the tree
The system SHALL, on deleting a step, re-parent its position-0 child to the
deleted step's parent, and delete every other child (tail) of the deleted step
along with any Outputs attached to those deleted tail nodes, returning the
count of Output placements removed.

#### Scenario: Deleting a mid-trunk step re-links the chain
- **WHEN** a step in the middle of the trunk with a single (position-0) child is
  deleted
- **THEN** that child is re-parented to the deleted step's former parent, and
  the trunk remains a single unbroken chain

#### Scenario: Deleting a step with a tail removes the tail and its Outputs
- **WHEN** a step with one or more tail children is deleted
- **THEN** every tail descendant of that step is deleted, every Output attached
  to a deleted tail node is deleted, and the number of removed placements is
  returned

### Requirement: The client groups steps into lanes
The client SHALL group a pipeline's flat `Step[]` into lanes: the position-0 chain from the root is the
PRIMARY lane, and each of a node's position >= 1 children begins its own lane. A lane continues through
single-child edges. The client SHALL NOT assume a node has at most one position >= 1 child, and SHALL NOT
drop or merge any child on the grounds of child count. A node with exactly one child at a position >= 1
remains a one-step-lane ("tail") for rendering purposes only.

Privileging the position-0 child is a UI decision this capability owns, sanctioned by the engine contract
(HEL-911 design.md item 2: *"'Trunk' is not an engine concept. It is a UI notion owned by P2.2."*). It
binds the CLIENT grouping only; no engine or repository behaviour is implied.

#### Scenario: A node with three children yields two lanes plus a continuation
- **WHEN** a node has three step children, at positions 0, 1 and 2
- **THEN** the position-0 child continues the node's own (primary) lane
- **THEN** the position-1 and position-2 children each root their own lane below it
- **THEN** no child is discarded, and no child is folded into another lane

#### Scenario: Children that all lack a position each root a lane
- **WHEN** a node has three step children, none of which carries a `position`
- **THEN** there is no continuation to privilege, and each child roots its own lane

#### Scenario: Every step is reachable in the grouping
- **WHEN** a pipeline's steps are grouped
- **THEN** the total number of steps across all lanes equals the input step count

#### Scenario: A pure chain is one lane
- **WHEN** every node has at most one child
- **THEN** the grouping reports a single lane containing every step in root-to-leaf order

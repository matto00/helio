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
The system SHALL interpret `pipeline_steps.position` as the sibling order among
children of the same parent, not a pipeline-wide sequence.

#### Scenario: A migrated trunk's positions are left unchanged
- **WHEN** the migration backfills `parent_step_id` for an existing pipeline
- **THEN** it does not rewrite any step's `position` value

### Requirement: The repository exposes tree-ordered reads
The system SHALL provide `trunkOf` (the position-0 chain from the root, in
order), `childrenOf`, and `tailsOf` reads over the step tree.

#### Scenario: trunkOf preserves pre-migration order
- **WHEN** `trunkOf` is called against a migrated pipeline
- **THEN** it returns the steps in the exact order they held before migration

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

### Requirement: At most one trunk child per node
The system SHALL enforce, in Phase 1, that a node has at most one position-0
(trunk) child, and that a tail node has no position ≥ 1 children of its own
(no branching within a tail).

#### Scenario: Attempting to add a second trunk child is rejected
- **WHEN** a second position-0 child is added to a node that already has one
- **THEN** the write is rejected with a named error

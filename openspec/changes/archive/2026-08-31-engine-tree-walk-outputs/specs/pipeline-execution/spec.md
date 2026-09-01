## ADDED Requirements

### Requirement: The engine walks the step tree, not a flat list

The pipeline execution engine SHALL evaluate a pipeline's steps as a tree (trunk plus tails), not a
linear `foldLeft`. It SHALL load the root frame, then walk the trunk (the `position = 0` chain) in
order. Before advancing past a trunk node to its trunk child, the engine SHALL evaluate every tail
(each `position >= 1` child and its descendants) rooted at that node, using that node's own frame as
the tail's starting input — not the frame produced by any later trunk step. Each tail SHALL be
evaluated as its own short fold, independent of the trunk's continuation and of any sibling tail.

#### Scenario: A tail off a mid-trunk step sees that step's frame

- **GIVEN** a pipeline whose trunk is `A -> B -> C`, with a tail `T` attached to `B`
- **WHEN** the pipeline runs
- **THEN** `T` is evaluated starting from `B`'s output frame
- **AND** `T`'s result is independent of whatever `C` (a later trunk step) produces

#### Scenario: Disabled steps are skipped in place on trunk and tails

- **GIVEN** a step with `enabled = false` on the trunk or on a tail
- **WHEN** the pipeline runs
- **THEN** that step is skipped and its child evaluates from the frame the disabled step would have
  received unchanged

### Requirement: A materialized node's frame is persisted to per-node snapshots

At every materialized node (a node with one or more Outputs attached), the engine SHALL persist that
node's frame as its `node_snapshots` rows, and derive each attached Output's `schema` field via
shallow union inference across the full row set. A non-materialized node's frame SHALL NOT be
persisted.

#### Scenario: Two Outputs on one node share one snapshot row set

- **GIVEN** a node with two Outputs attached
- **WHEN** the pipeline runs successfully
- **THEN** both Outputs' schemas are derived from the same persisted `node_snapshots` row set for
  that node
- **AND** only one set of snapshot rows exists for that node

#### Scenario: Only materialized nodes appear in node_snapshots

- **GIVEN** a pipeline with both materialized and non-materialized nodes
- **WHEN** the pipeline runs successfully
- **THEN** `node_snapshots` after the run contains rows only for the materialized nodes

#### Scenario: A successful run atomically replaces a node's prior snapshot

- **GIVEN** a materialized node with an existing snapshot from a prior successful run
- **WHEN** a new run succeeds
- **THEN** the node's snapshot rows are replaced with the new run's rows, with no history retained

#### Scenario: A failed run leaves the previous snapshot intact

- **GIVEN** a materialized node with an existing snapshot from a prior successful run
- **WHEN** a new run fails before completing
- **THEN** the node's snapshot rows remain exactly as they were before the failed run

### Requirement: A dry run returns per-Output preview rows without persisting anything

A dry run SHALL walk the same tree, in memory, and return per-Output preview rows equal to what a
live run would persist for the same input. A dry run SHALL NOT write to `node_snapshots` or any
Output's `schema` field.

#### Scenario: Dry-run preview equals the live-run snapshot for the same input

- **GIVEN** a pipeline and a fixed input
- **WHEN** a dry run and then a live run are each executed against that same input
- **THEN** the dry run's per-Output preview rows equal the live run's persisted per-Output snapshot
  rows

#### Scenario: A dry run persists nothing

- **GIVEN** any pipeline
- **WHEN** a dry run is executed
- **THEN** no `node_snapshots` row is written or modified

### Requirement: The engine rejects a Phase-1 graph invariant violation before running

Before evaluating any step, the engine SHALL validate the Phase-1 graph invariant: every node has at
most one child at `position = 0`; a tail node has no children at `position >= 1` and at most one
child at `position = 0`. A violation SHALL be rejected with a named `InvalidGraph` error identifying
the offending node, before any step is evaluated. The engine SHALL NOT silently pick one child and
proceed.

#### Scenario: A node with two position-0 children is rejected

- **GIVEN** a pipeline whose step tree has a node with two children both at `position = 0`
- **WHEN** the pipeline is run or dry-run
- **THEN** the engine rejects the run with `InvalidGraph: node <id> has 2 children at position 0`
- **AND** no step is evaluated

### Requirement: Parity with the pre-tree-walk engine for tail-free pipelines

For any pipeline whose step tree has no tails (a pure trunk), the tree walk's persisted rows and
derived schema SHALL be identical to what the prior flat-fold engine produced for the same pipeline
and input.

#### Scenario: A tail-free pipeline's output is unchanged

- **GIVEN** a pipeline with a pure-trunk step tree (no tails)
- **WHEN** it is run under the tree-walk engine
- **THEN** the persisted rows and derived schema for its materialized node(s) are identical to the
  previously-recorded flat-fold engine's output for the same pipeline and input

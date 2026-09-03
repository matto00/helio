## MODIFIED Requirements

### Requirement: The engine walks the step tree, not a flat list

The pipeline execution engine SHALL evaluate a pipeline's steps as a directed acyclic graph rooted at the source root, not a linear `foldLeft` and not a trunk-plus-tails tree. Any node MAY have any number of step children. It SHALL load the root frame, then evaluate nodes in an order that is topological over both parent-to-child edges and lane-reference-to-rejoin edges, using sibling `position` ascending as the deterministic tiebreak where the topological order does not itself decide. Each child SHALL be evaluated using its parent's own frame as its starting input — not the frame produced by any later node. Sibling lanes SHALL be independent of one another until a rejoin step explicitly consumes one. `position = 0` SHALL carry no structural meaning beyond serving as that tiebreak; "trunk" SHALL NOT be an engine concept.

#### Scenario: A lane off a mid-graph step sees that step's frame

- **GIVEN** a pipeline whose chain is `A -> B -> C`, with a second lane `T` attached to `B`
- **WHEN** the pipeline runs
- **THEN** `T` is evaluated starting from `B`'s output frame
- **AND** `T`'s result is independent of whatever `C` produces

#### Scenario: Disabled steps are skipped in place anywhere in the graph

- **GIVEN** a step with `enabled = false` anywhere in the graph
- **WHEN** the pipeline runs
- **THEN** that step is skipped and its children evaluate from the frame the disabled step would have received unchanged

#### Scenario: A node with several children evaluates all of them

- **GIVEN** a node with three step children at any positions
- **WHEN** the pipeline runs
- **THEN** all three are evaluated from that node's frame, in ascending sibling-position order
- **AND** no child is silently dropped and no structural error is raised

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

### Requirement: Parity with the pre-tree-walk engine for tail-free pipelines

For any pipeline whose graph contains no lane reference — including a pure trunk and a trunk-with-tails graph — the walk's persisted rows, derived schema, per-node row counts and node evaluation order SHALL be identical to what the Phase-1 tree-walk engine produced for the same pipeline and input.

#### Scenario: A tail-free pipeline's output is unchanged

- **GIVEN** a pipeline with a pure-trunk step tree (no tails)
- **WHEN** it is run under the DAG walk
- **THEN** the persisted rows and derived schema for its materialized node(s) are identical to the previously-recorded output for the same pipeline and input

#### Scenario: A trunk-with-tails pipeline's output is unchanged

- **GIVEN** a pipeline with tails and no lane reference
- **WHEN** it is run under the DAG walk
- **THEN** its rows, per-node row counts and evaluation order are identical to the Phase-1 tree-walk result for the same input

## REMOVED Requirements

### Requirement: The engine rejects a Phase-1 graph invariant violation before running

**Reason:** Phase 2 (HEL-911) deletes the Phase-1 graph invariant outright rather than retaining it as a mode. A node may now have any number of children at any positions, and a node reached via a `position >= 1` edge may have children of its own. The `InvalidGraph` pre-flight that enforced this invariant is removed at every site that raised it. Cycle rejection and same-pipeline membership validation (see `pipeline-lane-rejoin-input`) replace it as the engine's structural guarantees; the "SHALL NOT silently pick one child and proceed" property this requirement protected is preserved by `pipeline-steps-persistence`'s traversal requirement and by the engine no longer selecting a single child anywhere.

**Migration:** No user action. Graphs previously rejected as invariant violations now run.

#### Scenario: A node with two position-0 children is rejected

- **GIVEN** a pipeline whose step tree has a node with two children both at `position = 0`
- **WHEN** the pipeline is run or dry-run
- **THEN** the engine rejects the run with `InvalidGraph: node <id> has 2 children at position 0`
- **AND** no step is evaluated

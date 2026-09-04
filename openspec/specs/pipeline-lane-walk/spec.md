# pipeline-lane-walk Specification

## Purpose
The engine's multi-child DAG walk: any node may carry several step children (lanes) evaluated independently from their parent's frame, ordered topologically over parent-to-child and lane-reference-to-rejoin edges with sibling `position` as the deterministic tiebreak, reducing exactly to the Phase-1 trunk-and-tails order when no lane reference exists.. Update Purpose after archive.

## Requirements

### Requirement: A node may have any number of step children, evaluated as independent lanes
The execution engine SHALL treat a pipeline as a directed acyclic graph rooted at the source root. Any node, including the root, MAY have any number of step children. Each child SHALL be evaluated from its parent's frame. Sibling lanes SHALL NOT observe one another's rows and SHALL NOT thread into one another, until a rejoin step explicitly consumes one. The engine SHALL NOT reject a graph on the grounds of how many children a node has, nor on the position of those children.

#### Scenario: Two lanes off one node evaluate independently
- **WHEN** a node with frame `[{"a": 1}]` has two step children, one filtering to zero rows and one passing rows through
- **THEN** the pass-through lane's frame is `[{"a": 1}]`, unaffected by the filtering lane
- **THEN** both lanes report their own per-node row counts

#### Scenario: A node with two children at position 0 is no longer an error
- **WHEN** a pipeline is run whose root has two step children both at `position = 0`
- **THEN** the run succeeds and both children evaluate
- **THEN** no `InvalidGraph` error is raised by any layer

#### Scenario: A step below a lane may itself have several children
- **WHEN** a step reached via a `position >= 1` edge has two step children of its own
- **THEN** the run succeeds and both children evaluate from that step's frame
- **THEN** no `InvalidGraph` error is raised by any layer

### Requirement: Evaluation order is topological with sibling position as the deterministic tiebreak
Evaluation order SHALL be a topological sort over parent-to-child edges and lane-reference-to-rejoin edges. Among nodes not otherwise ordered, sibling `position` ascending SHALL be the tiebreak; among lanes originating at different roots, **root position ascending** SHALL be the tiebreak. Order SHALL be fully deterministic for a given graph.

#### Scenario: Lanes from two roots are ordered by root position
- **WHEN** two root-level steps attached to two different roots are otherwise unordered
- **THEN** the step attached to the lower-positioned root evaluates first

#### Scenario: A rejoin's referenced lane is evaluated first regardless of position
- **WHEN** a rejoin step at a lower sibling position references a node in a lane rooted at a higher sibling position
- **THEN** the referenced node is evaluated before the rejoin step
- **THEN** the rejoin step observes that node's post-evaluation frame

#### Scenario: Order is stable across repeated runs of the same graph
- **WHEN** the same branching pipeline is run twice with identical inputs
- **THEN** the per-node row counts and the order in which nodes are evaluated are identical

### Requirement: A graph with no lane reference evaluates exactly as it did in Phase 1
For any pipeline containing no lane-kind secondary input, the engine SHALL produce output byte-identical to the Phase-1 trunk-and-tails walk, with identical per-node row counts and identical node evaluation order.

#### Scenario: Pure trunk parity
- **WHEN** a pipeline consisting only of a trunk chain is run
- **THEN** its output rows, per-step row counts, and node outcomes are byte-identical to the Phase-1 result for the same input

#### Scenario: Trunk-plus-tails parity
- **WHEN** a pipeline with tails hanging off trunk nodes and no lane reference is run
- **THEN** its output rows, per-node row counts, and evaluation order are byte-identical to the Phase-1 result for the same input

### Requirement: Every node's frame is retained and addressable for the whole run
Every node's post-evaluation frame SHALL be retained for the whole run, addressable by its node key — including each root's loaded frame, addressable by that root's key. A rejoin SHALL be able to consume the frame of any node in the same pipeline, including a node in a lane originating at a different root.

#### Scenario: A rejoin consumes a lane originating at another root
- **WHEN** a `join` step in the first root's lane names a step in the second root's lane as its lane-kind secondary input
- **THEN** the join evaluates after that step and consumes its post-evaluation frame
- **THEN** the resulting rows reflect both roots' data

#### Scenario: A mid-lane node's frame is available to a rejoin
- **WHEN** a rejoin step references a node that is neither materialized nor terminal in its lane
- **THEN** that node's post-evaluation frame is supplied to the rejoin step
- **THEN** the referenced node is not evaluated a second time

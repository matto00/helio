## ADDED Requirements

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
The engine SHALL order evaluation topologically over both parent-to-child edges and lane-reference-to-rejoin edges, so that every node a rejoin step references has already been evaluated when that rejoin step runs. Where the topological order does not itself determine an ordering between two nodes, the engine SHALL order them by sibling `position` ascending. For a given graph the resulting evaluation order SHALL be deterministic across runs.

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
The engine SHALL retain the post-evaluation frame of every node in the graph for the duration of the run, keyed by that node's id, and SHALL make it available to any rejoin step referencing it. Retention SHALL NOT be limited to materialized nodes, nor to terminal nodes of a lane.

#### Scenario: A mid-lane node's frame is available to a rejoin
- **WHEN** a rejoin step references a node that is neither materialized nor terminal in its lane
- **THEN** that node's post-evaluation frame is supplied to the rejoin step
- **THEN** the referenced node is not evaluated a second time

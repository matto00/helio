## MODIFIED Requirements

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


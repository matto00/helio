## REMOVED Requirements

### Requirement: The engine walks the step tree, not a flat list
**Reason:** the requirement's title and text describe a walk rooted at a single source root, and two of its scenarios
("A tail off a mid-trunk step sees that step's frame", "Disabled steps are skipped in place on trunk and tails") are
pre-HEL-911 wordings already superseded by their own generalizations in the same block ("A lane off a mid-graph step
...", "Disabled steps are skipped in place anywhere in the graph"). A MODIFIED requirement replaces its whole block and
may not drop scenarios, so keeping the requirement would mean shipping a block carrying both a rule and its superseded
predecessor — two near-identical scenarios where only one is the real guard, which is how a guard gets quietly
weakened. Replaced wholesale instead (round-1 skeptic CR9).

**Replaced by:** "The engine walks a multi-root graph, not a flat list" below.

## ADDED Requirements

### Requirement: The engine walks a multi-root graph, not a flat list
The engine SHALL walk the pipeline as a directed acyclic graph rooted at **one or more** roots. Each root SHALL contribute its own loaded frame, seeded under that root's own node key before the walk begins. A step with no parent step SHALL be evaluated from the frame of the root it is attached to.

Node outcomes SHALL be keyed by a node key that distinguishes each root from every other root and from every step; a single unnamed root sentinel SHALL NOT be used.

#### Scenario: Each root seeds its own frame
- **WHEN** a two-root pipeline is walked
- **THEN** the node outcomes contain one entry per root, each holding that root's loaded rows

#### Scenario: A single-root pipeline walks exactly as before
- **WHEN** a single-root pipeline with no lane reference is walked
- **THEN** the evaluation order and every per-node frame are identical to the pre-multi-root walk

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


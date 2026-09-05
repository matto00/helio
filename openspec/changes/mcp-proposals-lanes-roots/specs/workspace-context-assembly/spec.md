## ADDED Requirements

### Requirement: Each pipeline carries a compact lane tree with Outputs per node
Each pipeline entry in the workspace context SHALL carry a compact lane tree alongside its existing
`roots` array: for every node, its id, its parent node's id (absent for a root-level node), its
originating root's id, its op kind, and the ids and names of the Outputs bound at that node. The tree
SHALL NOT carry step configs, projected schemas, or sample rows.

The lane tree SHALL participate in the existing budget-trimming and truncation machinery exactly as
every other non-structural field does: when trimmed, the truncation report SHALL say so explicitly
rather than silently emitting a partial tree.

#### Scenario: A two-root, two-lane pipeline reports its whole shape
- **WHEN** workspace context is assembled for a pipeline with two roots, a lane under each, and a
  `join` rejoin carrying an Output
- **THEN** its entry's lane tree carries every node with its parent and originating root, and the
  rejoin node lists its Output

#### Scenario: A root-level node reports no parent and names its root
- **WHEN** a pipeline's lane tree includes a step attached directly to its second root
- **THEN** that node's entry omits a parent id and names the second root as its originating root

#### Scenario: A node with no Outputs reports an empty Output list
- **WHEN** a pipeline's lane tree includes an intermediate step with no Outputs bound to it
- **THEN** that node's entry carries an empty Output list rather than omitting the field

#### Scenario: Lane-tree trimming is reported, never silent
- **WHEN** the budget forces the lane tree to be trimmed
- **THEN** the truncation report names the lane tree as trimmed and the response remains valid
  against the workspace-context schema

#### Scenario: The assembled context stays under the result cap on the reference fixture
- **WHEN** workspace context is assembled at the default budget for the reference multi-pipeline
  fixture
- **THEN** the serialized response is within the MCP result cap

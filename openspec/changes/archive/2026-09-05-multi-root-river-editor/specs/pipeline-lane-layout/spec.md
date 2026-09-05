# pipeline-lane-layout Specification

## MODIFIED Requirements

### Requirement: Layout assigns every node a deterministic lane and row
The layout unit SHALL map a pipeline's roots and flat `Step[]` to a slot per node, and the mapping SHALL be a pure
function of the graph (each root's `position`, each step's originating root, `parentStepId`, sibling `position`, and
array order) — never of render order, hover state, or elapsed time. Given the same input the layout SHALL produce
byte-identical output. Lanes SHALL be grouped and ordered by originating root: every lane descending from a
lower-positioned root SHALL be assigned a lower column index than any lane descending from a higher-positioned root,
so a root's lanes are contiguous rather than interleaved with another root's.

#### Scenario: Same input yields the same layout
- **WHEN** the layout is computed twice from the same roots and `Step[]`
- **THEN** every node's lane index and row index are identical between the two results

#### Scenario: Siblings occupy distinct adjacent lanes
- **WHEN** a node has three step children, at positions 0, 1 and 2
- **THEN** the position-0 child stays in the node's own lane column (it continues its lane)
- **THEN** the position-1 and position-2 children are assigned adjacent, distinct column indices beside it
- **THEN** the lane order follows ascending sibling `position`, with array order as the tiebreak

#### Scenario: A single-child chain stays in one lane
- **WHEN** every node in a single-root pipeline has at most one step child
- **THEN** every node is assigned the same lane index, and rows increase monotonically from the root

#### Scenario: Each root's lanes are contiguous
- **WHEN** root 0 branches into two lanes and root 1 branches into two lanes
- **THEN** root 0's two lanes occupy adjacent column indices
- **THEN** every one of root 1's lane columns has a higher index than every one of root 0's

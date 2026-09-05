# pipeline-lane-layout Specification

## Purpose
Assigns every node of a pipeline's step DAG a deterministic column-grid slot, so sibling branches render
as parallel lanes in the river and a rejoin step visually spans back to a single column.

## Requirements

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

### Requirement: A rejoin node spans back to one column
A node consuming a `{kind:"lane"}` secondary input SHALL be placed in a single lane column, at a row strictly
below every node it consumes, and the layout SHALL expose the rejoin's incoming lane edges so the river can
draw a connector from each consumed lane into that one column.

#### Scenario: Two lanes rejoin
- **WHEN** lane 0's node `a` and lane 1's node `b` are both consumed by a `union` step `c`
- **THEN** `c` occupies exactly one lane column
- **THEN** `c`'s row is greater than both `a`'s and `b`'s rows
- **THEN** the layout reports two incoming lane edges for `c`, naming `a` and `b`

#### Scenario: One lane feeds several rejoins
- **WHEN** node `a` in lane 0 is referenced as the secondary input of two different rejoin steps
- **THEN** both rejoins are laid out, and both report `a` among their incoming lane edges
- **THEN** neither rejoin is dropped, deduplicated away, or reported as invalid

#### Scenario: A rejoin may reference a non-terminal node
- **WHEN** a rejoin's `{kind:"lane"}` secondary input names a node that has children of its own
- **THEN** the layout places and reports it exactly as it would a terminal node

### Requirement: Layout is total over unreachable and in-flight nodes
The layout SHALL place every step it is given. A step not reachable from the root by parent edges — a
locally created, not-yet-persisted step, or orphaned data — SHALL be assigned a slot rather than dropped.

#### Scenario: An in-flight step with no parent is still placed
- **WHEN** a step with no `parentStepId` and no `position` is present alongside a fully linked graph
- **THEN** the layout returns a slot for it, and the node count of the layout equals the input step count

## ADDED Requirements

### Requirement: The client groups steps into lanes
The client SHALL group a pipeline's flat `Step[]` into lanes: the position-0 chain from the root is the
PRIMARY lane, and each of a node's position >= 1 children begins its own lane. A lane continues through
single-child edges. The client SHALL NOT assume a node has at most one position >= 1 child, and SHALL NOT
drop or merge any child on the grounds of child count. A node with exactly one child at a position >= 1
remains a one-step-lane ("tail") for rendering purposes only.

Privileging the position-0 child is a UI decision this capability owns, sanctioned by the engine contract
(HEL-911 design.md item 2: *"'Trunk' is not an engine concept. It is a UI notion owned by P2.2."*). It
binds the CLIENT grouping only; no engine or repository behaviour is implied.

#### Scenario: A node with three children yields two lanes plus a continuation
- **WHEN** a node has three step children, at positions 0, 1 and 2
- **THEN** the position-0 child continues the node's own (primary) lane
- **THEN** the position-1 and position-2 children each root their own lane below it
- **THEN** no child is discarded, and no child is folded into another lane

#### Scenario: Children that all lack a position each root a lane
- **WHEN** a node has three step children, none of which carries a `position`
- **THEN** there is no continuation to privilege, and each child roots its own lane

#### Scenario: Every step is reachable in the grouping
- **WHEN** a pipeline's steps are grouped
- **THEN** the total number of steps across all lanes equals the input step count

#### Scenario: A pure chain is one lane
- **WHEN** every node has at most one child
- **THEN** the grouping reports a single lane containing every step in root-to-leaf order

## REMOVED Requirements

### Requirement: At most one trunk child per node
**Reason**: Stale. This requirement describes the Phase-1 structural fence that P2.1 (HEL-911) deleted at
all three enforcement sites. It already contradicts "Requirement: Position orders siblings, not the whole
pipeline" in the same capability, which HEL-911 added and which states that no layer SHALL reject a graph
on the grounds of how many children a node has. Leaving it would make this capability's spec contradict the
lane grouping this same change adds to it.
**Migration**: None. The behaviour it describes was already removed from the code by HEL-911; only the
spec text lagged. No frontend or backend change accompanies this removal.

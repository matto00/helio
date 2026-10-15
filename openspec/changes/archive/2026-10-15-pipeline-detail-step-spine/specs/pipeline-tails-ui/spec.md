## MODIFIED Requirements

### Requirement: Tail renders as an indented dashed chain
A one-step lane whose steps carry Outputs — the Phase-1 "tail" — SHALL keep its existing indented,
dashed-connector rendering beneath its parent step, visually distinct from the primary-lane connector
style. Generalizing the grouping to n lanes SHALL NOT change how this shape renders.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop a tail (a branch lane) renders as an indented, labelled sub-spine under its parent step, with the same row treatment as the trunk (not a dashed chain of cards).

#### Scenario: Tail ends in an Output chip
- **WHEN** a tail's leaf step has one or more Outputs
- **THEN** the tail chain visually terminates in those Output chip(s)

#### Scenario: A tail renders as it did before lanes
- **WHEN** a pipeline whose only branching is a single tail off one step is rendered
- **THEN** the rendered output is unchanged from the pre-lanes rendering of the same pipeline

#### Scenario: Desktop tail as sub-spine
- **WHEN** a step has a tail on desktop
- **THEN** the tail renders indented under that step as a labelled sub-spine

### Requirement: Tail accepts the same step operations as the trunk
Drag-reorder, insert, duplicate, and enable/disable SHALL function identically on tail steps and
trunk steps.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop a tail's rows accept Branch from here and Add output and are selectable and editable through the focused editor exactly like trunk rows; Move and Insert items are trunk-only, as before.

#### Scenario: Reorder within a tail
- **WHEN** a user drags a tail step to a new position within the same tail
- **THEN** the tail's step order updates and persists exactly as trunk reordering does

#### Scenario: Desktop tail rows accept the same operations
- **WHEN** the user selects a tail row on desktop
- **THEN** its editor and preview table are shown and its row menu offers Branch from here and Add output

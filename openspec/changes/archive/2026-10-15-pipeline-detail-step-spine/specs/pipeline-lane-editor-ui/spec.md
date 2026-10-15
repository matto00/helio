## MODIFIED Requirements

### Requirement: Sibling lanes render side by side
A step with more than one step child SHALL render its children as parallel lanes below it, laid out on the
shared column grid. Each lane SHALL be its own vertical mini-river of `StepCard`s with its own Outputs rail.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop sibling lanes do not render side by side: each lane is an indented sub-spine directly under the row of the step it branches from, nested by depth, headed by a quiet label "Lane <n> · from <step number> <step label>" (never the accent). Rows of a lane are selectable exactly like trunk rows. Side by side columns remain on the phone river view.

#### Scenario: Two lanes off one step
- **WHEN** a `filter` step has two step children
- **THEN** two lanes render below it, horizontally adjacent, each containing its child and that child's descendants
- **THEN** each lane renders its own Outputs rail for its own steps' Outputs

#### Scenario: A lane is labelled at phone widths
- **WHEN** two or more lanes render below a step at a phone viewport width (<= 430px)
- **THEN** each lane carries a visible, stable header identifying which lane it is

#### Scenario: The lane header is suppressed at desktop widths
- **WHEN** the same lanes render above the phone breakpoint
- **THEN** the lane header is not displayed — side-by-side column position already conveys which lane is
  which, so the header would be redundant chrome (see `pipeline-lane-layout`)

#### Scenario: Desktop lanes are labelled sub-spines
- **WHEN** step 2 has a branch lane on desktop
- **THEN** the lane renders indented under step 2 with the label "Lane 1 · from 2 <label>" and its rows are selectable

### Requirement: "+ lane" is offered on any step
The editor SHALL offer a "+ lane" affordance on every step, regardless of how many children that step
already has. The editor SHALL NOT disable, hide, or refuse the affordance on the grounds of an existing
child count.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop "Branch from here" in every step row's menu is the "+ lane" affordance, offered on any step of any lane; it opens the step palette and creates a lane step under that step.

#### Scenario: Adding a second lane to a step that already has one
- **WHEN** the user activates "+ lane" on a step that already has one step child and picks an op
- **THEN** a new step is created as an additional child of that step
- **THEN** the river re-renders with two lanes below that step, and no refusal message is shown

#### Scenario: Adding a third lane
- **WHEN** the user activates "+ lane" on a step that already has two step children
- **THEN** a third lane is created and rendered

#### Scenario: Desktop Branch from here
- **WHEN** the user opens any step row's menu on desktop
- **THEN** "Branch from here" is listed and creates a branch under that step

### Requirement: Analyze and validation render on every lane
Per-node schema, per-node validation errors, and inline previews SHALL render on steps in every lane,
using the same presentation as a step in the primary lane.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop every lane's rows show the validation-error and warning markers, and the selected step's editor shows its validation error and warnings, for steps in any lane.

#### Scenario: A validation error in a non-primary lane
- **WHEN** a step in the second lane has an analyze validation error
- **THEN** that error renders on that step's card, in that lane

#### Scenario: Desktop validation on lane rows
- **WHEN** a step in a branch lane has an analyze validation error
- **THEN** its spine row shows the validation-error marker and its focused editor shows the message

### Requirement: Drag-reorder operates within a lane
Drag-reorder and move up/down SHALL be available on the trunk lane of EVERY root (not only the first root),
SHALL reorder steps within the lane the moved step belongs to, and SHALL NOT move a step into a different
lane or root. Non-trunk (branch) lanes SHALL NOT offer reorder controls, because the reorder endpoint does
not permute them. Each Move up/down control SHALL have an accessible name that identifies its lane (the root's
source name for a root lane), SHALL be keyboard-operable, and keyboard focus SHALL remain on the moved step's
corresponding Move control after the reorder. A reorder SHALL persist across reload.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop drag reorder operates within a trunk lane on the spine's rows (a grip appears on hover, the drop indicator is a neutral line, never the accent), and "Move up"/"Move down" in the row menu is the keyboard path; branch lanes are not reordered, as before.

#### Scenario: Reordering inside the second lane
- **WHEN** the user drags the second step of lane 1 above the first step of lane 1
- **THEN** lane 1's step order changes and persists
- **THEN** no step in any other lane changes position or parent

#### Scenario: Reordering a non-first root's lane with the keyboard
- **WHEN** a pipeline has two roots and the user activates "Move step up" on the second step of root 2's lane
- **THEN** that step moves above the first step of root 2's lane, persists across a reload, and keyboard focus
  stays on that step's Move control
- **THEN** root 1's lane order and every step's owning root are unchanged

#### Scenario: Move controls name their lane
- **WHEN** a pipeline has two roots with lanes
- **THEN** each lane's Move controls have an accessible name that includes that root's source name

#### Scenario: Branch lanes offer no reorder controls
- **WHEN** a step has a branch (non-trunk) lane
- **THEN** that lane's step cards render no Move up/down buttons and no drag handle

#### Scenario: Desktop reorder within a trunk
- **WHEN** the user chooses "Move down" on step 1 of a trunk lane on desktop
- **THEN** the persisted trunk ids are reordered within that lane only and focus returns to the moved row

## Purpose
Defines how the pipeline river renders and edits parallel lanes: side-by-side mini-rivers with their own
Outputs rails, the "+ lane" authoring affordance, per-lane analyze display, and mobile lane stacking.

## ADDED Requirements

### Requirement: Sibling lanes render side by side
A step with more than one step child SHALL render its children as parallel lanes below it, laid out on the
shared column grid. Each lane SHALL be its own vertical mini-river of `StepCard`s with its own Outputs rail.

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

### Requirement: "+ lane" is offered on any step
The editor SHALL offer a "+ lane" affordance on every step, regardless of how many children that step
already has. The editor SHALL NOT disable, hide, or refuse the affordance on the grounds of an existing
child count.

#### Scenario: Adding a second lane to a step that already has one
- **WHEN** the user activates "+ lane" on a step that already has one step child and picks an op
- **THEN** a new step is created as an additional child of that step
- **THEN** the river re-renders with two lanes below that step, and no refusal message is shown

#### Scenario: Adding a third lane
- **WHEN** the user activates "+ lane" on a step that already has two step children
- **THEN** a third lane is created and rendered

### Requirement: Analyze and validation render on every lane
Per-node schema, per-node validation errors, and inline previews SHALL render on steps in every lane,
using the same presentation as a step in the primary lane.

#### Scenario: A validation error in a non-primary lane
- **WHEN** a step in the second lane has an analyze validation error
- **THEN** that error renders on that step's card, in that lane

### Requirement: Drag-reorder operates within a lane
Drag-reorder and move up/down SHALL reorder steps within the lane the dragged step belongs to, and SHALL
NOT move a step into a different lane.

#### Scenario: Reordering inside the second lane
- **WHEN** the user drags the second step of lane 1 above the first step of lane 1
- **THEN** lane 1's step order changes and persists
- **THEN** no step in any other lane changes position or parent

### Requirement: Lanes stack vertically on phone widths
At phone viewport widths lanes SHALL stack vertically, each preceded by a lane header naming the lane,
and every interactive control SHALL remain at least 44 CSS pixels in both dimensions.

#### Scenario: Two lanes at 375px
- **WHEN** a pipeline with two lanes is rendered at a 375px-wide viewport
- **THEN** the lanes are stacked vertically rather than side by side
- **THEN** each lane is preceded by a lane header
- **THEN** every interactive control in the river measures at least 44x44 CSS pixels

#### Scenario: Two lanes at 430px
- **WHEN** the same pipeline is rendered at a 430px-wide viewport
- **THEN** the lanes are stacked vertically and the 44px floor holds

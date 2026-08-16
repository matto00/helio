# pipeline-editor-page Delta Specification

## ADDED Requirements

### Requirement: Steps can be inserted between existing steps in the editor

The pipeline editor SHALL offer an "insert step here" affordance in each gap of the step list —
before the first step card and between each adjacent pair (appending after the last step remains
the existing add-step row). The affordance SHALL:

- Open the existing op-type picker anchored at that gap; selecting an op creates the step at that
  list index via the create endpoint's optional `position`
- Reflect the inserted step immediately at the chosen position (optimistic), reconciling with the
  persisted step on success; on failure, keep the local step and surface a visible error (the
  editor's existing add-step failure convention)
- Leave the existing append flow unchanged
- Trigger the editor's existing analyze refresh (and thereby per-step validation/preview updates)
  after the insert settles

#### Scenario: Insert before the first step

- **WHEN** the user activates the insert affordance above the first step card and picks an op
- **THEN** the new step appears first, the previously-first step moves to second, and the order
  persists across reload

#### Scenario: Insert between two steps

- **WHEN** the user activates the insert affordance between step cards A and B and picks an op
- **THEN** the new step appears between A and B, later steps shift down by one, and the order
  persists across reload

#### Scenario: Append is unchanged

- **WHEN** the user adds a step via the existing bottom add-step control
- **THEN** the step is appended at the end exactly as before

#### Scenario: Analyze refreshes after an insert

- **WHEN** a step is inserted between existing steps
- **THEN** the pipeline re-analyzes without manual action and downstream steps' schemas/validation
  reflect the new upstream step

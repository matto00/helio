# pipeline-step-validation-display Specification

## Purpose
Make a step's analyze `validationError` impossible to miss in the pipeline editor: the error message renders inline on the offending StepCard for every op kind, and the errored card itself is visually and accessibly marked in the step list, clearing automatically once the config is fixed.
## Requirements
### Requirement: A step's analyze validationError renders inline on its own StepCard for every op kind
The StepCard component SHALL render the step's analyze `validationError` as an inline error
message in the expanded card body for every op kind, using the shared inline-error affordance.
The `compute` op's editor SHALL keep its existing editor-inline rendering without a duplicate
generic message. When the step has no `validationError`, no error message SHALL render.

#### Scenario: Errored non-compute step shows its message
- **WHEN** a non-compute step's analyze result carries a `validationError` and its card is
  expanded
- **THEN** the error text renders inline in that card's body

#### Scenario: Compute op does not double-render its error
- **WHEN** a compute step has a `validationError` and its card is expanded
- **THEN** exactly one rendering of the error appears (the compute editor's own)

#### Scenario: Valid step shows no error message
- **WHEN** a step's analyze result has no `validationError`
- **THEN** no inline error message renders in its card

### Requirement: An errored step card is visually distinguishable in the step list
The StepCard SHALL be visually marked as errored whenever its `validationError` is present:
- An error accent on the card itself (design-token error styling), visible in both collapsed and
  expanded states
- A compact indicator in the card header with an accessible name (perceivable by screen readers),
  visible without expanding the card
- The marking SHALL derive solely from the same `validationError` the inline message uses, and
  SHALL disappear automatically when a subsequent analyze refresh returns no error for the step

#### Scenario: Collapsed errored card is marked
- **WHEN** a step has a `validationError` and its card is collapsed
- **THEN** the card shows the error accent and the header indicator (with its accessible name)
  without the user expanding anything

#### Scenario: Marking clears when the error is fixed
- **WHEN** an errored step's config is corrected and the analyze refresh returns no
  `validationError` for it
- **THEN** the error accent, header indicator, and inline message all disappear

#### Scenario: Valid steps carry no marking
- **WHEN** a step has no `validationError`
- **THEN** its card shows no error accent and no header indicator


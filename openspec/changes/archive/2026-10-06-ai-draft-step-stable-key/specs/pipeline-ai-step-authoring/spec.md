## ADDED Requirements

### Requirement: Creating a completed draft step keeps its card open and its edits

When a draft AI step's create request succeeds and the editor reconciles the draft with the persisted step, the step's
card SHALL NOT be reset: if its editor was open it SHALL remain open, and its lane SHALL NOT be re-rendered as a new
lane. Any edit made to the draft's config while its create request was in flight SHALL be saved to the persisted step,
so that the persisted config matches what the editor shows. Steps added through the create-immediately paths SHALL
keep their existing behaviour.

#### Scenario: The open draft stays open when its create resolves
- **WHEN** the user completes a draft AI step's config in its open editor and the create request then succeeds
- **THEN** the step's card is still expanded with its editor showing, and the card is now the persisted step

#### Scenario: An edit made while the create is in flight is saved
- **WHEN** the user edits a draft AI step's config after its create request was sent but before it resolved
- **THEN** after the create resolves, the persisted step is updated with the edited config, and the editor still shows
  the edited value

#### Scenario: A lane-add draft on a step with no children stays open when created
- **WHEN** the user adds an AI step as a new lane from a step that has no children, completes its config in its open
  editor, and the create request succeeds
- **THEN** the draft is shown as the head of its own lane before and after the create, and its card is still expanded

#### Scenario: A rejected save of an in-flight edit is shown
- **WHEN** saving an edit made while the draft's create was in flight is rejected by the backend
- **THEN** the step's card shows an inline error naming the cause

#### Scenario: A later resync does not reset the created draft's card
- **WHEN** a draft AI step has been created and the editor later refreshes the full step list from the server
- **THEN** that step's card keeps its expanded state

#### Scenario: Create-immediately paths are unchanged
- **WHEN** the user adds a non-AI step by append, insert-between, or lane add
- **THEN** its card's expand control is disabled until the create is reconciled, exactly as before

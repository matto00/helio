## ADDED Requirements

### Requirement: A step card cannot be expanded while its create is in flight

When the editor shows a step optimistically, before the server has confirmed it (append, insert-between, or lane
add), that step card's expand control SHALL be disabled until the persisted step replaces the optimistic one.
Opening the editor or editing the step SHALL NOT be possible during that window, so no open editor is collapsed
and no edit is discarded when the step is reconciled. If the create fails, the expand control SHALL become enabled
again, so the user can open the card and use its existing controls, including Remove. A step that the editor
deliberately keeps local until its configuration is complete (an AI draft step) SHALL remain expandable.

#### Scenario: Expand is unavailable until the added step is persisted

- **WHEN** the user adds a step and the server has not yet confirmed it
- **THEN** that step card's expand control is disabled, and activating it does not open the editor

#### Scenario: Expand works once the step is persisted

- **WHEN** the server confirms the added step and the editor has reconciled it
- **THEN** the step card's expand control is enabled, opening it shows the step's editor, and an edit made there is
  saved to the persisted step

#### Scenario: A failed create leaves the step expandable

- **WHEN** creating the added step fails
- **THEN** the editor shows its existing failure message, keeps the local step, and the step card's expand control
  is enabled

#### Scenario: AI draft steps remain editable before creation

- **WHEN** the user adds an AI step that stays a local draft until its configuration is complete
- **THEN** its step card's expand control is enabled and its editor can be opened and edited

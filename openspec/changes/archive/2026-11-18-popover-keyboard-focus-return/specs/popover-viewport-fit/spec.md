## ADDED Requirements

### Requirement: A failed appearance save keeps the editor open with keyboard focus on Save
While a dashboard appearance save is in flight, the Save control MUST remain focusable and be announced as unavailable (`aria-disabled="true"`), and further submits MUST be ignored. If the save fails, the editor MUST stay open, keep the picked preset, show the error, and keep focus on Save.

#### Scenario: Keyboard save fails
- **GIVEN** the appearance editor is open, a preset has been picked with the keyboard, and the save request will fail
- **WHEN** the user activates Save with the keyboard
- **THEN** the error is shown, the editor stays open with the picked preset still selected, and focus is on Save

#### Scenario: A further focus move after the failure does not discard the pick
- **GIVEN** a keyboard save has failed and focus is on Save
- **WHEN** the user presses Shift+Tab
- **THEN** focus moves to the previous control inside the editor and the editor stays open

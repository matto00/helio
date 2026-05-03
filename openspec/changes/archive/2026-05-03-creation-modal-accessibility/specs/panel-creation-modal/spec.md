## MODIFIED Requirements

### Requirement: Modal dismisses without creating a panel
The user MUST be able to cancel the modal at any step without creating a panel. Dismissal MUST be
supported via the close button, the Escape key, or clicking the backdrop outside the modal content.
If the modal is in a dirty state (a panel type has been selected, a template has been selected, or
the title field is non-empty), the system MUST prompt for discard confirmation before closing.

#### Scenario: User closes modal via close button (clean)
- **WHEN** the user clicks the close button on the modal
- **AND** no data has been entered
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via close button (dirty — confirmed)
- **WHEN** the user clicks the close button on the modal
- **AND** the user has entered data
- **AND** the user confirms the discard prompt
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via Escape key (clean)
- **WHEN** the modal is open and the user presses Escape
- **AND** no data has been entered
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via Escape key (dirty — confirmed)
- **WHEN** the modal is open and the user presses Escape
- **AND** the user has entered data
- **AND** the user confirms the discard prompt
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via Escape key (dirty — cancelled)
- **WHEN** the modal is open and the user presses Escape
- **AND** the user has entered data
- **AND** the user cancels the discard prompt
- **THEN** the modal remains open with data preserved

#### Scenario: User closes modal via click outside (clean)
- **WHEN** the user clicks the backdrop area outside the modal content
- **AND** no data has been entered
- **THEN** the modal closes
- **AND** no panel is created

#### Scenario: User closes modal via click outside (dirty — confirmed)
- **WHEN** the user clicks the backdrop area outside the modal content
- **AND** the user has entered data
- **AND** the user confirms the discard prompt
- **THEN** the modal closes
- **AND** no panel is created

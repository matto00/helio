## ADDED Requirements

### Requirement: Question resets with the answer on a scope change
When an ask surface's scope changes (a different dashboard in the drawer, or a different Output on the sheet), the
typed question SHALL be cleared together with the answer, pending state and error. Within one scope the question SHALL
still be kept in every state.

#### Scenario: Dashboard switch with the drawer mounted
- **WHEN** a user types a question in the ask drawer for dashboard A, and the selected dashboard changes to B
- **THEN** the question field is empty and no answer or error from A is shown

#### Scenario: Same scope keeps the question
- **WHEN** an ask for the current dashboard returns an error
- **THEN** the question stays in the field

## ADDED Requirements

### Requirement: Escape on a popover inside a modal closes only the popover
When a portalled popover (an actions menu, a select list, the output schema panel, or any other popover built on the
shared portal-popover behaviour) is open inside an open modal dialog, Escape SHALL close that popover only and return
focus to its trigger; the modal SHALL stay open. Escape SHALL still reach window-level Escape handlers. A further
Escape with no popover open SHALL close the modal as before.

#### Scenario: Actions menu inside a modal
- **WHEN** an actions menu inside an open modal is open and the user presses Escape
- **THEN** the menu closes, focus returns to its trigger, and the modal stays open

#### Scenario: Second Escape closes the modal
- **WHEN** the user presses Escape again with no popover open
- **THEN** the modal closes

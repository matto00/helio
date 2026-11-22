## ADDED Requirements

### Requirement: A compact counter reserves no space for its empty live regions

In the compact single-counter layout, the always-mounted alert (`role="alert"`) and status (`role="status"`) regions
SHALL take no layout space while they hold no text, so no blank band appears below the counter (or, for a non-owner,
below the session-change caption). Both regions SHALL remain in the DOM and in the accessibility tree at all times;
they SHALL NOT be mounted conditionally, hidden with `display: none`, or hidden with `visibility: hidden`. When a
region holds a message it SHALL render visibly inside the card.

#### Scenario: Empty regions leave no blank space
- **WHEN** a compact counter form card renders in the single-column panel stack at 390 px, 768 px or 1100 px with the
  sidebar open, in light or dark theme, with both live regions empty
- **THEN** the space between the bottom of the last visible content (the caption for a non-owner, the counter row
  for the owner) and the bottom of the compact layout is no more than the layout's own bottom padding

#### Scenario: A status message still shows and is announced
- **WHEN** a step on a compact counter succeeds and the status region receives "The row was added."
- **THEN** the same status element that was mounted before the step shows the text visibly inside the card
- **AND** it is exposed with role `status` in the accessibility tree

#### Scenario: An alert message still shows and is announced
- **WHEN** a step on a compact counter is rejected and the alert region receives a message
- **THEN** the same alert element that was mounted before the step shows the text visibly inside the card
- **AND** it is exposed with role `alert` in the accessibility tree

#### Scenario: Other panel kinds keep their height
- **WHEN** the per-kind stack heights are measured at 390, 768 and 1100 px before and after the change
- **THEN** every panel other than the compact counter card has the same height (within 0.5 px)

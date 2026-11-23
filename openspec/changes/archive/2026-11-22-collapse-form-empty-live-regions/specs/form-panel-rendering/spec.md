## ADDED Requirements

### Requirement: A multi-field form reserves no space for its empty live regions

In the standard (non-compact) form layout, the always-mounted alert (`role="alert"`) and status (`role="status"`)
regions inside the form's field stack SHALL take no layout space while they hold no text, so the space between the
last field and the Submit control is a single stack gap. Both regions SHALL remain in the DOM and in the accessibility
tree at all times; they SHALL NOT be mounted conditionally, hidden with `display: none`, or hidden with
`visibility: hidden`. When a region holds a message it SHALL render visibly, in flow, between the last field and the
Submit control.

#### Scenario: Empty regions leave no blank space below the last field
- **WHEN** a multi-field form card renders in the single-column panel stack at 390 px, 768 px or 1100 px with the
  sidebar open, in light or dark theme, with both live regions empty
- **THEN** the distance from the bottom of the last field to the top of the Submit control is no more than one gap of
  the field stack

#### Scenario: A status message still shows and is announced
- **WHEN** a multi-field form submit succeeds and the status region receives its message
- **THEN** the same status element that was mounted before the submit shows the text visibly, in flow, above Submit
- **AND** it is exposed with role `status` in the accessibility tree

#### Scenario: An alert message still shows and is announced
- **WHEN** a multi-field form submit is rejected and the alert region receives a message
- **THEN** the same alert element that was mounted before the submit shows the text visibly, in flow, above Submit
- **AND** it is exposed with role `alert` in the accessibility tree

#### Scenario: Other panel kinds keep their height
- **WHEN** the per-kind stack heights are measured at 390, 768 and 1100 px before and after the change
- **THEN** every panel other than the multi-field form card, including the compact counter card, has the same height
  (within 0.5 px)

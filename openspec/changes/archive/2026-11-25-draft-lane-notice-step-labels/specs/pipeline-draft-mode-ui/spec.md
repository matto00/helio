## ADDED Requirements

### Requirement: A refused save names steps by label
When Save & run is refused with a validation message that names steps, the draft notice SHALL show by its label
every step the page knows: a step of the draft, or a saved step the draft removed. It SHALL NOT show any such step's
id, quoted or not. The notice's "Couldn't save step" prefix SHALL name the step or Output the message names first,
never one named later in the message, such as a lane target. An id the page holds nowhere (a step the draft created
and then deleted) MAY be shown as is. The draft SHALL be kept, as before.

#### Scenario: Lane-cycle refusal
- **WHEN** Save & run is refused because step "Sort rows" has a lane reference to step "Limit" that would be its
  descendant, and "Limit" comes before "Sort rows" on the page
- **THEN** the notice reads `Couldn't save step "Sort rows": ` followed by the message, with both steps shown by
  label
- **THEN** no step id appears in the notice, and the draft is still present

#### Scenario: A step created in the draft
- **WHEN** the refused message names a step the draft created, by its client id
- **THEN** the notice shows that step's label, not its client id

#### Scenario: Lane target removed in the draft
- **WHEN** a draft deletes a step that another step's lane reference names, and Save & run is refused because that
  lane reference names a step that is not in the draft
- **THEN** the notice names the referencing step by label in its prefix and names the removed target by its saved
  label, with no step id shown

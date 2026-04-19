## ADDED Requirements

### Requirement: TypeDetailPanel displays a Computed fields section
The `TypeDetailPanel` SHALL display a "Computed fields" section below the regular fields list. The section SHALL show all existing computed fields and a button to add a new one.

#### Scenario: No computed fields shows empty state
- **WHEN** a DataType has no computed fields
- **THEN** the Computed fields section shows a message indicating no computed fields and an "Add computed field" button

#### Scenario: Existing computed fields are listed
- **WHEN** a DataType has one or more computed fields
- **THEN** each computed field is shown with its display name, expression, and output type, along with edit and remove controls

### Requirement: User can add a computed field
The UI SHALL allow the user to add a new computed field by providing: name (identifier), display name, expression, and output type. The form SHALL be shown inline or in a modal within the Computed fields section.

#### Scenario: Add form opens on button click
- **WHEN** the user clicks "Add computed field"
- **THEN** an input form appears with fields for name, display name, expression, and output type selector

#### Scenario: Saving a valid computed field updates the DataType
- **WHEN** the user fills in all required fields with valid values and submits
- **THEN** `PATCH /api/types/:id` is called with the updated `computedFields` array and the new field appears in the list on success

#### Scenario: Name field is required
- **WHEN** the user submits the add form with an empty name
- **THEN** a validation error is shown and the form is not submitted

### Requirement: User can edit an existing computed field
The UI SHALL allow the user to edit the expression, display name, or output type of an existing computed field.

#### Scenario: Edit populates the form with existing values
- **WHEN** the user clicks the edit control on a computed field
- **THEN** the edit form is populated with the current name, display name, expression, and output type

#### Scenario: Saving edited field updates the DataType
- **WHEN** the user modifies an expression and saves
- **THEN** `PATCH /api/types/:id` is called with the updated entry and the list reflects the change

### Requirement: User can remove a computed field
The UI SHALL allow the user to remove a computed field with a confirmation step to prevent accidental deletion.

#### Scenario: Remove button triggers confirmation
- **WHEN** the user clicks the remove control on a computed field
- **THEN** a confirmation prompt is shown before deletion proceeds

#### Scenario: Confirmed removal updates the DataType
- **WHEN** the user confirms removal
- **THEN** `PATCH /api/types/:id` is called without the removed field and it disappears from the list

### Requirement: Inline expression validation before saving
The expression input SHALL validate the expression against the backend validation endpoint on blur. A validation error SHALL be shown inline; the save button SHALL be disabled while an error is present.

#### Scenario: Invalid expression shows inline error
- **WHEN** the user enters an invalid expression and moves focus away from the expression input
- **THEN** an inline error message is displayed below the input describing the problem

#### Scenario: Valid expression clears inline error
- **WHEN** the user corrects a previously invalid expression
- **THEN** the inline error is cleared and the save button becomes enabled

#### Scenario: Save is disabled while expression error is present
- **WHEN** the expression input has a validation error
- **THEN** the save/submit button is disabled

### Requirement: Computed fields appear in the field picker with a distinguishing label
When a panel's field picker lists available fields from a bound DataType, computed fields SHALL appear alongside regular fields and SHALL be marked with a visual label (e.g. "computed") to distinguish them.

#### Scenario: Field picker includes computed fields
- **WHEN** a panel is bound to a DataType that has computed fields
- **THEN** the field picker lists both regular and computed fields

#### Scenario: Computed fields are visually distinguished
- **WHEN** a computed field appears in the field picker
- **THEN** it has a label or badge indicating it is a computed field

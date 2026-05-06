# panel-creation-type-config Specification

## Purpose
TBD - created by archiving change panel-creation-initial-config. Update Purpose after archive.
## Requirements
### Requirement: Step 3 of the creation modal shows type-specific config fields
The panel creation modal step 3 (title/config step) MUST render optional type-specific configuration
fields below the title input, determined by the panel type selected in step 1. All fields SHALL be
optional — the user MAY leave them blank and configure later via the detail modal.

#### Scenario: Metric panel shows value label and unit inputs
- **WHEN** the user has selected the Metric panel type and reaches step 3
- **THEN** a "Value label" text input is shown below the title field
- **AND** a "Unit" text input is shown below the value label input
- **AND** both inputs are optional (no required indicator)

#### Scenario: Chart panel shows chart type selector
- **WHEN** the user has selected the Chart panel type and reaches step 3
- **THEN** a "Chart type" selector is shown below the title field
- **AND** the selector offers three options: Line, Bar, Pie
- **AND** no option is pre-selected (field is optional)

#### Scenario: Image panel shows image URL input
- **WHEN** the user has selected the Image panel type and reaches step 3
- **THEN** an "Image URL" text input is shown below the title field
- **AND** the input is optional

#### Scenario: Divider panel shows orientation selector
- **WHEN** the user has selected the Divider panel type and reaches step 3
- **THEN** an "Orientation" selector is shown below the title field
- **AND** the selector offers two options: Horizontal, Vertical
- **AND** no option is pre-selected (field is optional)

#### Scenario: Text panel shows no additional fields
- **WHEN** the user has selected the Text panel type and reaches step 3
- **THEN** no additional configuration fields are shown beyond the title input

#### Scenario: Table panel shows no additional fields
- **WHEN** the user has selected the Table panel type and reaches step 3
- **THEN** no additional configuration fields are shown beyond the title input

#### Scenario: Markdown panel shows no additional fields
- **WHEN** the user has selected the Markdown panel type and reaches step 3
- **THEN** no additional configuration fields are shown beyond the title input

### Requirement: Type-specific config values are included in the creation payload
When the user submits the creation form, any type-specific config values entered in step 3 MUST be
included in the panel creation request so they take effect immediately without requiring a follow-up
edit via the detail modal.

#### Scenario: Metric config submitted with creation
- **GIVEN** the user has entered a value label and/or unit in step 3
- **WHEN** the user confirms panel creation
- **THEN** the creation payload includes the value label and/or unit under the metric config fields

#### Scenario: Chart type submitted with creation
- **GIVEN** the user has selected a chart type in step 3
- **WHEN** the user confirms panel creation
- **THEN** the creation payload includes the selected chart type

#### Scenario: Image URL submitted with creation
- **GIVEN** the user has entered an image URL in step 3
- **WHEN** the user confirms panel creation
- **THEN** the creation payload includes the image URL

#### Scenario: Divider orientation submitted with creation
- **GIVEN** the user has selected an orientation in step 3
- **WHEN** the user confirms panel creation
- **THEN** the creation payload includes the selected orientation

#### Scenario: Empty optional fields are omitted from payload
- **GIVEN** the user leaves all type-specific config fields blank
- **WHEN** the user confirms panel creation
- **THEN** the creation payload does not include the optional config fields (or omits their values)
- **AND** the panel is created with backend-default values for those fields

### Requirement: Non-empty type-specific config fields mark the modal as dirty
If the user has entered any value in a type-specific config field, the modal MUST be treated as dirty
for the purpose of the discard-confirmation prompt.

#### Scenario: Config field entry triggers dirty state
- **GIVEN** the user reaches step 3 and enters a value in a type-specific config field
- **WHEN** the user attempts to close or dismiss the modal
- **THEN** the discard-confirmation prompt is shown

### Requirement: Type-specific config state resets on modal close
All type-specific config field values MUST be cleared when the modal closes, regardless of whether
a panel was created.

#### Scenario: Config fields reset after cancel
- **WHEN** the user cancels the creation modal after having entered config values
- **AND** reopens the modal
- **THEN** all type-specific config fields are empty

#### Scenario: Config fields reset after successful create
- **WHEN** the user creates a panel and the modal closes
- **AND** the user opens the modal again
- **THEN** all type-specific config fields are empty


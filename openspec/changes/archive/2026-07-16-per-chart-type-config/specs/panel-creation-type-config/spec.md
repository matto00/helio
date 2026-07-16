# panel-creation-type-config — Delta

## MODIFIED Requirements

### Requirement: Step 3 of the creation modal shows type-specific config fields
The panel creation modal step 3 (title/config step) MUST render optional type-specific configuration
fields below the title input, determined by the panel type selected in step 1. All fields SHALL be
optional — the user MAY leave them blank and configure later via the detail modal. `divider` is not a
selectable type in step 1 (HEL-249) and therefore has no step-3 config fields.

#### Scenario: Metric panel shows value label and unit inputs
- **WHEN** the user has selected the Metric panel type and reaches step 3
- **THEN** a "Value label" text input is shown below the title field
- **AND** a "Unit" text input is shown below the value label input
- **AND** both inputs are optional (no required indicator)

#### Scenario: Chart panel shows chart type selector
- **WHEN** the user has selected the Chart panel type and reaches step 3
- **THEN** a "Chart type" selector is shown below the title field
- **AND** the selector offers four options: Line, Bar, Pie, Scatter
- **AND** no option is pre-selected (field is optional)

#### Scenario: Image panel shows image URL input
- **WHEN** the user has selected the Image panel type and reaches step 3
- **THEN** an "Image URL" text input is shown below the title field
- **AND** the input is optional

#### Scenario: Text panel shows no additional fields
- **WHEN** the user has selected the Text panel type and reaches step 3
- **THEN** no additional configuration fields are shown beyond the title input

#### Scenario: Table panel shows no additional fields
- **WHEN** the user has selected the Table panel type and reaches step 3
- **THEN** no additional configuration fields are shown beyond the title input

#### Scenario: Markdown panel shows no additional fields
- **WHEN** the user has selected the Markdown panel type and reaches step 3
- **THEN** no additional configuration fields are shown beyond the title input

## MODIFIED Requirements

### Requirement: Modal type picker presents all available panel types
The type picker step MUST offer all creatable panel types as selectable options. No creatable type SHALL be hidden or disabled by default.
`divider` is not a creatable type (HEL-249) — existing divider
panels remain supported for rendering/editing/back-compat per the `divider-panel-type` spec, but the
picker never offers it.

#### Scenario: All panel types are visible on modal open
- **WHEN** the panel creation modal opens
- **THEN** the type picker shows options for: metric, chart, text, table, markdown, image
- **AND** no `divider` option is shown

#### Scenario: User selects a panel type and advances
- **WHEN** the user selects a panel type card
- **THEN** the selection is highlighted
- **AND** the user can proceed to the next step

### Requirement: Modal second step selects a template, third step (data-bound types only) selects a DataType, final step names the panel
After type selection, the modal MUST present a template picker as Step 2 before advancing. For
data-bound panel types (metric, chart, text, table), a DataType picker step (Step 3) MUST follow
template selection before the title/config form (Step 4). For non-data-bound types (markdown, image),
template selection MUST advance directly to the title/config form (Step 3). The title/config
form MUST display a live panel preview pane alongside the form inputs. The form SHALL be displayed in
one column and the preview in a second column on viewports 600 px and wider. The name-entry step
MUST also render optional type-specific configuration fields below the title input as defined by the
panel-creation-type-config spec.

#### Scenario: Template step follows type selection
- **WHEN** the user selects a panel type card
- **THEN** the template-select step is shown
- **AND** template cards for that panel type are displayed
- **AND** a "Start blank" card is shown at the end of the grid

#### Scenario: DataType step follows template selection for data-bound types
- **WHEN** the user selects a template card (or Start blank) for a data-bound panel type (metric, chart, text, table)
- **THEN** the DataType picker step is shown

#### Scenario: Name-entry step follows template selection for non-data-bound types
- **WHEN** the user selects a template card (or Start blank) for a non-data-bound panel type (markdown, image)
- **THEN** the name-entry step is shown directly

#### Scenario: Name-entry step follows DataType selection for data-bound types
- **WHEN** the user selects a DataType and clicks Next on the DataType step
- **THEN** the name-entry step is shown

#### Scenario: User can navigate back from template step
- **WHEN** the user is on the template-select step
- **AND** clicks the Back button
- **THEN** the type-select step is shown
- **AND** no template selection is retained

#### Scenario: User can navigate back from DataType step
- **WHEN** the user is on the DataType picker step
- **AND** clicks the Back button
- **THEN** the template-select step is shown
- **AND** no DataType selection is retained

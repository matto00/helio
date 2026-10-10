## ADDED Requirements

### Requirement: Output editor field labels are associated with their controls
Every visible field label in the Output editor sheet that names a single control SHALL be programmatically associated
with that control, including labels whose control is the shared `Select`. The shared `Select` SHALL accept an optional
`id` that is applied to its combobox trigger; when no `id` is passed it SHALL render no `id` attribute on the trigger.

#### Scenario: Kind label resolves in create mode
- **WHEN** the sheet is opened to create a new Output
- **THEN** querying by the label text "Kind" returns the Kind combobox, and "Step" returns the Step combobox

#### Scenario: Kind label resolves in edit mode with its lock description intact
- **WHEN** the sheet is opened for an existing Output
- **THEN** querying by the label text "Kind" returns the disabled Kind combobox
- **AND** its accessible description is still the "kind can't be changed" hint

### Requirement: Table options fit the Configuration card on a narrow viewport
At a 375px-wide viewport, a table Output's options in the Configuration card (Cell density and each Columns row,
including its format select and move controls) SHALL lie within the card's content box, in both light and dark themes.

#### Scenario: Table Output at 375px
- **WHEN** a table Output is open in the editor at a 375px viewport
- **THEN** no table option control's right edge extends past the Configuration card's right edge

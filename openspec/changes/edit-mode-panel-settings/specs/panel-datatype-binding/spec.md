## MODIFIED Requirements

### Requirement: User can bind a panel to a DataType
The panel detail modal's unified edit mode form SHALL include a Data section (for data-capable panel types) that allows the user to select a registered DataType from a searchable dropdown showing type name, source type badge, and field count. Selecting a DataType SHALL populate the field mapping section within the same form.

#### Scenario: DataType list is shown in the Data section when edit mode is opened
- **WHEN** the user enters edit mode on a data-capable panel (metric, chart, etc.)
- **THEN** the Data section is visible in the unified form with the registered DataTypes loaded and displayed in a searchable dropdown

#### Scenario: Selecting a DataType shows field mapping in the same form
- **WHEN** the user selects a DataType from the dropdown in the Data section
- **THEN** the field mapping rows appear directly below within the same section

#### Scenario: No DataTypes available shows empty state
- **WHEN** edit mode is opened and no DataTypes are registered
- **THEN** the dropdown is empty and an "Add a new source →" link is shown in the Data section

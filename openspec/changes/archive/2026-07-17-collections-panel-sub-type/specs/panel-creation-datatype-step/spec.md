## MODIFIED Requirements

### Requirement: DataType picker step for data-bound panel types during creation
The modal SHALL present a DataType picker step after template selection when the selected panel type
is data-bound (metric, chart, text, table, collection). The picker SHALL list only DataTypes
referenced by at least one pipeline via `outputDataTypeId`. Non-data-bound types (markdown, image,
divider) SHALL skip this step and advance directly to the name-entry step.

#### Scenario: DataType step appears after template selection for metric type
- **WHEN** the user selects the "metric" type card and then selects a template
- **THEN** the DataType picker step is shown
- **AND** the name-entry step is not yet shown

#### Scenario: DataType step appears after template selection for chart type
- **WHEN** the user selects the "chart" type card and then selects a template
- **THEN** the DataType picker step is shown

#### Scenario: DataType step appears after template selection for text type
- **WHEN** the user selects the "text" type card and then selects a template
- **THEN** the DataType picker step is shown

#### Scenario: DataType step appears after template selection for table type
- **WHEN** the user selects the "table" type card and then selects a template
- **THEN** the DataType picker step is shown

#### Scenario: DataType step appears after template selection for collection type
- **WHEN** the user selects the "collection" type card and then selects a template
- **THEN** the DataType picker step is shown

#### Scenario: DataType step is skipped for markdown type
- **WHEN** the user selects the "markdown" type card and then selects a template
- **THEN** the name-entry step is shown immediately
- **AND** no DataType picker step is shown

#### Scenario: DataType step is skipped for image type
- **WHEN** the user selects the "image" type card and then selects a template
- **THEN** the name-entry step is shown immediately

#### Scenario: DataType step is skipped for divider type
- **WHEN** the user selects the "divider" type card and then selects a template
- **THEN** the name-entry step is shown immediately

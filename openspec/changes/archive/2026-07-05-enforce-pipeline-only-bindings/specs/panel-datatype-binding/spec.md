## MODIFIED Requirements

### Requirement: User can bind a panel to a DataType
The panel detail modal's unified edit mode form SHALL include a Data section (for data-capable panel types)
that allows the user to select a pipeline-output DataType (`sourceId == null`) from a searchable dropdown
showing type name and field count. Companion DataTypes created from source registration (`sourceId != null`)
SHALL NOT appear in the dropdown. Selecting a DataType SHALL populate the field mapping section within the
same form.

#### Scenario: DataType list is shown in the Data section when edit mode is opened
- **WHEN** the user enters edit mode on a data-capable panel (metric, chart, etc.)
- **THEN** the Data section is visible in the unified form with the registered pipeline-output DataTypes
  loaded and displayed in a searchable dropdown

#### Scenario: Companion DataTypes are not offered as binding targets
- **WHEN** the DataType dropdown is rendered and the store contains a DataType with `sourceId != null`
- **THEN** that DataType does not appear in the dropdown

#### Scenario: Selecting a DataType shows field mapping in the same form
- **WHEN** the user selects a DataType from the dropdown in the Data section
- **THEN** the field mapping rows appear directly below within the same section

#### Scenario: No DataTypes available shows empty state
- **WHEN** edit mode is opened and no pipeline-output DataTypes are registered
- **THEN** the dropdown is empty and a link to the Pipelines page is shown in the Data section

## ADDED Requirements

### Requirement: Backend rejects binding a panel to a companion DataType
`POST /api/panels` and `PATCH /api/panels/:id` SHALL reject a request whose data type reference
(`dataTypeId`/`typeId`) resolves to a DataType with a non-null `sourceId`, returning 400 with a message
indicating panels can only bind to pipeline-output data types. Unbinding (`typeId: null`) and references to
pipeline-output DataTypes are unaffected.

#### Scenario: Creating a panel bound to a companion DataType is rejected
- **WHEN** `POST /api/panels` is called with a `dataTypeId` resolving to a DataType with `sourceId != null`
- **THEN** the response is 400 and no panel is created

#### Scenario: Re-binding a panel to a companion DataType is rejected
- **WHEN** `PATCH /api/panels/:id` is called with a `typeId` resolving to a DataType with `sourceId != null`
- **THEN** the response is 400 and the panel's binding is unchanged

#### Scenario: Binding to a pipeline-output DataType still succeeds
- **WHEN** `PATCH /api/panels/:id` is called with a `typeId` resolving to a DataType with `sourceId == null`
- **THEN** the response is 200 with the binding applied

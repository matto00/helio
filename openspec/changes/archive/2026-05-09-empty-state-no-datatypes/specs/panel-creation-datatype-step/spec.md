## MODIFIED Requirements

### Requirement: DataType picker lists only registry-produced DataTypes
The DataType picker SHALL display only DataTypes whose `id` appears as the `outputDataTypeId` of at
least one pipeline. Each entry SHALL show the DataType name. If the pipelines list is not yet
loaded, the modal SHALL dispatch a fetch on step entry. When no registry DataTypes exist and both
slices have finished loading (`status === "succeeded"`), the empty state UI SHALL be shown in place
of the list (see `panel-creation-datatype-empty-state` spec). While either slice has status `loading`
or `idle`, neither the list nor the empty state SHALL be shown.

#### Scenario: Only pipeline-produced DataTypes are shown
- **WHEN** the DataType step is rendered
- **AND** two DataTypes exist but only one has a pipeline referencing it via outputDataTypeId
- **THEN** only the pipeline-referenced DataType is shown in the picker list

#### Scenario: No registry DataTypes shows empty state with pipeline link
- **WHEN** the DataType step is rendered
- **AND** both `pipelines.status` and `dataTypes.status` are `succeeded`
- **AND** no DataTypes are referenced by any pipeline
- **THEN** the empty state UI is shown with `data-testid="datatype-empty-state"`
- **AND** a link with `data-testid="datatype-empty-pipeline-link"` navigating to `/pipelines` is shown

#### Scenario: Empty state is not shown while slices are loading
- **WHEN** the DataType step is rendered
- **AND** `pipelines.status` is `loading`
- **THEN** neither the DataType list nor the empty state is shown

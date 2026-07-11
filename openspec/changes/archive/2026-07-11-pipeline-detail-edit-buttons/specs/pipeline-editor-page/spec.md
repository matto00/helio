## MODIFIED Requirements

### Requirement: Pipeline detail page renders at /pipelines/:id
The frontend SHALL render a `PipelineDetailPage` component when the user navigates to `/pipelines/:id`. The page SHALL display four sections: a read-only bound-source bar, a read-only bound-type bar, river view in the scrollable middle, and footer bar at the bottom.

#### Scenario: Route renders detail page
- **WHEN** the user navigates to `/pipelines/some-id`
- **THEN** `PipelineDetailPage` is rendered

### Requirement: Source selector bar loads from API
The bound-source bar SHALL display the pipeline's single bound data source, read-only: the source name (`currentPipeline.sourceDataSourceName`) and, when a matching `DataSource` is resolvable by id (`currentPipeline.sourceDataSourceId`) from the already-fetched `state.sources.items` (loaded via the `fetchSources` thunk), its kind (CSV / REST API / SQL / Static). The bar SHALL NOT offer per-source toggling, a preview affordance, or a "Connect source" action — a pipeline has exactly one input source, so there is nothing to select or connect. When the matching `DataSource` is resolvable (i.e. the current user owns it), the bar SHALL show an "Edit Source" button that, when clicked, sets `sources.selectedSourceId` to that source's id and navigates to `/sources`. When no matching `DataSource` is resolvable, the "Edit Source" button SHALL NOT be rendered.

#### Scenario: Bound source name and kind are rendered
- **WHEN** `state.sources.items` contains a DataSource whose id matches `currentPipeline.sourceDataSourceId`
- **THEN** the bound-source bar shows that source's name and its kind label

#### Scenario: Bound source name renders without a kind badge when unresolved
- **WHEN** no DataSource in `state.sources.items` matches `currentPipeline.sourceDataSourceId`
- **THEN** the bound-source bar shows the source name with no kind badge

#### Scenario: Edit Source button shown when the current user owns the source
- **WHEN** `state.sources.items` contains a DataSource whose id matches `currentPipeline.sourceDataSourceId`
- **THEN** an "Edit Source" button is visible in the bound-source bar

#### Scenario: Edit Source button hidden when the current user does not own the source
- **WHEN** no DataSource in `state.sources.items` matches `currentPipeline.sourceDataSourceId` (e.g. the pipeline was shared with the current user by a pipeline-sharing grant, but the underlying source belongs to someone else)
- **THEN** no "Edit Source" button is rendered in the bound-source bar

#### Scenario: Clicking Edit Source navigates to the source detail page
- **WHEN** the user clicks the "Edit Source" button
- **THEN** `sources.selectedSourceId` is set to the bound source's id and the app navigates to `/sources`

## ADDED Requirements

### Requirement: Bound-type bar displays the pipeline's output DataType
`PipelineDetailPage` SHALL render a read-only bound-type bar showing the pipeline's output DataType name (`currentPipeline.outputDataTypeName`). The page SHALL fetch `state.dataTypes.items` (via the `fetchDataTypes` thunk) on mount if not already loaded, so ownership of the output DataType can be determined the same way source ownership is: by presence in the already-fetched, owner-scoped list.

#### Scenario: Bound-type bar shows the output type name
- **WHEN** `PipelineDetailPage` is rendered with a loaded `currentPipeline`
- **THEN** the bound-type bar shows `currentPipeline.outputDataTypeName`

### Requirement: Edit Type button is ownership-gated
When `state.dataTypes.items` contains a DataType whose id matches `currentPipeline.outputDataTypeId` (i.e. the current user owns it), the bound-type bar SHALL show an "Edit Type" button that, when clicked, sets `dataTypes.selectedTypeId` to that DataType's id and navigates to `/registry`. When no matching DataType is found in `state.dataTypes.items`, the "Edit Type" button SHALL NOT be rendered.

#### Scenario: Edit Type button shown when the current user owns the output type
- **WHEN** `state.dataTypes.items` contains a DataType whose id matches `currentPipeline.outputDataTypeId`
- **THEN** an "Edit Type" button is visible in the bound-type bar

#### Scenario: Edit Type button hidden when the current user does not own the output type
- **WHEN** no DataType in `state.dataTypes.items` matches `currentPipeline.outputDataTypeId`
- **THEN** no "Edit Type" button is rendered in the bound-type bar

#### Scenario: Clicking Edit Type navigates to the type registry
- **WHEN** the user clicks the "Edit Type" button
- **THEN** `dataTypes.selectedTypeId` is set to the output DataType's id and the app navigates to `/registry`

### Requirement: Pipeline-sharing role does not grant source/type edit access
A pipeline-sharing `editor` or `viewer` grant (see `pipeline-sharing`) confers no ownership of the pipeline's bound DataSource or output DataType. The "Edit Source" / "Edit Type" buttons SHALL be gated solely on DataSource/DataType ownership (presence in the current user's owner-scoped `sources.items` / `dataTypes.items`), never on pipeline ownership or pipeline-sharing role alone.

#### Scenario: Shared pipeline editor without source ownership sees no Edit Source button
- **WHEN** the current user has an `editor` grant on the pipeline but does not own its bound
  DataSource (it is absent from `state.sources.items`)
- **THEN** no "Edit Source" button is rendered, even though the user can edit pipeline steps

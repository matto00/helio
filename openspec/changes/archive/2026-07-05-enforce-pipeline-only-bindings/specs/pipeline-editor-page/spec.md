## MODIFIED Requirements

### Requirement: Pipeline detail page renders at /pipelines/:id
The frontend SHALL render a `PipelineDetailPage` component when the user navigates to `/pipelines/:id`. The page SHALL display three sections: a read-only bound-source bar at the top, river view in the scrollable middle, and footer bar at the bottom.

#### Scenario: Route renders detail page
- **WHEN** the user navigates to `/pipelines/some-id`
- **THEN** `PipelineDetailPage` is rendered

### Requirement: Source selector bar loads from API
The bound-source bar SHALL display the pipeline's single bound data source, read-only: the source name (`currentPipeline.sourceDataSourceName`) and, when a matching `DataSource` is resolvable by id (`currentPipeline.sourceDataSourceId`) from the already-fetched `state.sources.items` (loaded via the `fetchSources` thunk), its kind (CSV / REST API / SQL / Static). The bar SHALL NOT offer per-source toggling, a preview affordance, or a "Connect source" action — a pipeline has exactly one input source, so there is nothing to select or connect.

#### Scenario: Bound source name and kind are rendered
- **WHEN** `state.sources.items` contains a DataSource whose id matches `currentPipeline.sourceDataSourceId`
- **THEN** the bound-source bar shows that source's name and its kind label

#### Scenario: Bound source name renders without a kind badge when unresolved
- **WHEN** no DataSource in `state.sources.items` matches `currentPipeline.sourceDataSourceId`
- **THEN** the bound-source bar shows the source name with no kind badge

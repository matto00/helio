## MODIFIED Requirements

### Requirement: Source selector bar loads from API
The page header SHALL display the pipeline's bound data source, read-only, in a compact
single-line field group: the source name (`currentPipeline.roots[0].dataSourceName`) and, when a
matching `DataSource` is resolvable by id (`currentPipeline.roots[0].dataSourceId`) from the
already-fetched `state.sources.items` (loaded via the `fetchSources` thunk), its kind (CSV /
REST API / SQL / Static). The removed scalars `sourceDataSourceName`/`sourceDataSourceId` SHALL
NOT be read; the source is resolved from the first element of the pipeline's `roots` array, which
states the single-root assumption explicitly rather than hiding it in a field name.

When `roots` is empty or absent, the header SHALL render no source name and no kind badge, and
SHALL NOT throw.

The header SHALL NOT offer per-source toggling, a preview affordance, a "Connect source" action,
or any affordance for adding, removing, or switching roots. When the matching `DataSource` is
resolvable (i.e. the current user owns it), an "Edit source" action SHALL be available in the
header's single actions menu (see "Header actions consolidate into one menu" below) that, when
activated, sets `sources.selectedSourceId` to that source's id and navigates to `/sources`. When
no matching `DataSource` is resolvable, the "Edit source" action SHALL NOT appear in the menu.

#### Scenario: Bound source name and kind are rendered
- **WHEN** `state.sources.items` contains a DataSource whose id matches `currentPipeline.roots[0].dataSourceId`
- **THEN** the page header shows that source's name and its kind label

#### Scenario: Bound source name renders without a kind badge when unresolved
- **WHEN** no DataSource in `state.sources.items` matches `currentPipeline.roots[0].dataSourceId`
- **THEN** the page header shows the source name with no kind badge

#### Scenario: Header renders safely when the pipeline has no roots
- **WHEN** `currentPipeline.roots` is empty or absent
- **THEN** the header renders without a source name or kind badge and no error is thrown

#### Scenario: Edit source action shown when the current user owns the source
- **WHEN** `state.sources.items` contains a DataSource whose id matches `currentPipeline.roots[0].dataSourceId`, and the user opens the header's actions menu
- **THEN** an "Edit source" menu item is visible

#### Scenario: Edit source action hidden when the current user does not own the source
- **WHEN** no DataSource in `state.sources.items` matches `currentPipeline.roots[0].dataSourceId` (e.g. the pipeline was shared with the current user by a pipeline-sharing grant, but the underlying source belongs to someone else), and the user opens the header's actions menu
- **THEN** no "Edit source" menu item is rendered

#### Scenario: Activating Edit source navigates to the source detail page
- **WHEN** the user opens the header's actions menu and activates "Edit source"
- **THEN** `sources.selectedSourceId` is set to the bound source's id and the app navigates to `/sources`

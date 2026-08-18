## MODIFIED Requirements

### Requirement: Pipeline detail page renders at /pipelines/:id
The frontend SHALL render a `PipelineDetailPage` component when the user navigates to
`/pipelines/:id`. The page SHALL display three sections: a single header region combining the
read-only bound-source info, the read-only bound-type info, and the schedule summary; a river
view in the scrollable middle; and a single footer region at the bottom containing every footer
action (output name editor, output schema, step count, run status, save/cancel, run history,
preview, dry run, run, share, and last-run metadata). No additional bar or strip SHALL render
above the river view or below the footer region.

#### Scenario: Route renders detail page
- **WHEN** the user navigates to `/pipelines/some-id`
- **THEN** `PipelineDetailPage` is rendered

#### Scenario: Only one region appears above the river view
- **WHEN** `PipelineDetailPage` is rendered with a loaded `currentPipeline`
- **THEN** exactly one header region is visible above the step list, containing the source, type,
  and schedule information together

#### Scenario: Only one region appears below the river view
- **WHEN** `PipelineDetailPage` is rendered with a loaded `currentPipeline`
- **THEN** exactly one footer region is visible below the step list, with no separate bar or
  strip rendered beneath it

### Requirement: Source selector bar loads from API
The page header SHALL display the pipeline's single bound data source, read-only, in a compact
single-line field group: the source name (`currentPipeline.sourceDataSourceName`) and, when a
matching `DataSource` is resolvable by id (`currentPipeline.sourceDataSourceId`) from the
already-fetched `state.sources.items` (loaded via the `fetchSources` thunk), its kind (CSV /
REST API / SQL / Static). The header SHALL NOT offer per-source toggling, a preview affordance,
or a "Connect source" action — a pipeline has exactly one input source, so there is nothing to
select or connect. When the matching `DataSource` is resolvable (i.e. the current user owns it),
an "Edit source" action SHALL be available in the header's single actions menu (see "Header
actions consolidate into one menu" below) that, when activated, sets `sources.selectedSourceId`
to that source's id and navigates to `/sources`. When no matching `DataSource` is resolvable, the
"Edit source" action SHALL NOT appear in the menu.

#### Scenario: Bound source name and kind are rendered
- **WHEN** `state.sources.items` contains a DataSource whose id matches `currentPipeline.sourceDataSourceId`
- **THEN** the page header shows that source's name and its kind label

#### Scenario: Bound source name renders without a kind badge when unresolved
- **WHEN** no DataSource in `state.sources.items` matches `currentPipeline.sourceDataSourceId`
- **THEN** the page header shows the source name with no kind badge

#### Scenario: Edit source action shown when the current user owns the source
- **WHEN** `state.sources.items` contains a DataSource whose id matches `currentPipeline.sourceDataSourceId`, and the user opens the header's actions menu
- **THEN** an "Edit source" menu item is visible

#### Scenario: Edit source action hidden when the current user does not own the source
- **WHEN** no DataSource in `state.sources.items` matches `currentPipeline.sourceDataSourceId` (e.g. the pipeline was shared with the current user by a pipeline-sharing grant, but the underlying source belongs to someone else), and the user opens the header's actions menu
- **THEN** no "Edit source" menu item is rendered

#### Scenario: Activating Edit source navigates to the source detail page
- **WHEN** the user opens the header's actions menu and activates "Edit source"
- **THEN** `sources.selectedSourceId` is set to the bound source's id and the app navigates to `/sources`

### Requirement: Bound-type bar displays the pipeline's output DataType
The page header SHALL show the pipeline's output DataType name
(`currentPipeline.outputDataTypeName`), read-only. The page SHALL fetch `state.dataTypes.items`
(via the `fetchDataTypes` thunk) on mount if not already loaded, so ownership of the output
DataType can be determined the same way source ownership is: by presence in the already-fetched,
owner-scoped list.

#### Scenario: Page header shows the output type name
- **WHEN** `PipelineDetailPage` is rendered with a loaded `currentPipeline`
- **THEN** the page header shows `currentPipeline.outputDataTypeName`

### Requirement: Edit Type action is ownership-gated
The header's single actions menu SHALL include an "Edit type" item when `state.dataTypes.items`
contains a DataType whose id matches `currentPipeline.outputDataTypeId` (i.e. the current user
owns it); activating it sets `dataTypes.selectedTypeId` to that DataType's id and navigates to
`/registry`. When no matching DataType is found in `state.dataTypes.items`, the "Edit type" item
SHALL NOT appear in the menu.

#### Scenario: Edit type action shown when the current user owns the output type
- **WHEN** `state.dataTypes.items` contains a DataType whose id matches `currentPipeline.outputDataTypeId`, and the user opens the header's actions menu
- **THEN** an "Edit type" menu item is visible

#### Scenario: Edit type action hidden when the current user does not own the output type
- **WHEN** no DataType in `state.dataTypes.items` matches `currentPipeline.outputDataTypeId`, and the user opens the header's actions menu
- **THEN** no "Edit type" menu item is rendered

#### Scenario: Activating Edit type navigates to the type registry
- **WHEN** the user opens the header's actions menu and activates "Edit type"
- **THEN** `dataTypes.selectedTypeId` is set to the output DataType's id and the app navigates to `/registry`

### Requirement: Header actions consolidate into one menu
The page header SHALL expose exactly one action-menu trigger button (not one button per action)
for its per-field edit actions. The menu SHALL be built from the existing `ActionsMenu` shared
component (`frontend/src/shared/chrome/ActionsMenu.tsx`) and list only the actions the current
user has, gated exactly as each individual action's own requirement specifies ("Edit source",
"Edit type" above; "Edit schedule" / "Set schedule" per `pipeline-schedule-config-ui`). The
schedule's enable/disable toggle SHALL remain a directly-visible control in the header, outside
this menu.

#### Scenario: One trigger exposes every available action
- **WHEN** the current user owns both the bound source and the output type, and the pipeline has an existing schedule
- **THEN** the header shows exactly one actions-menu trigger button, and opening it lists "Edit source", "Edit type", and "Edit schedule" as menu items

#### Scenario: Menu narrows to only the actions the user has
- **WHEN** the current user does not own the bound source (but owns the output type, and the pipeline has a schedule)
- **THEN** opening the header's actions menu lists only "Edit type" and "Edit schedule", omitting "Edit source"

### Requirement: Footer pins primary actions and collapses the rest into an overflow menu
The page footer's action group SHALL always render exactly two plain, always-visible buttons —
"Dry run" and "Run pipeline" — at every viewport, per `pipeline-dry-run-ui`'s and
`pipeline-run-status-ui`'s own requirements for those two buttons. "Run history", "Preview", and
"Share" (owner-only, per `pipeline-sharing`) SHALL instead be exposed as items in a second
`ActionsMenu` instance ("More actions") rendered alongside "Dry run"/"Run pipeline", rather than
as their own always-visible buttons.

#### Scenario: Dry run and Run pipeline remain always visible
- **WHEN** the pipeline detail page footer is rendered, at any viewport width
- **THEN** "Dry run" and "Run pipeline" are visible as plain buttons, not inside any menu

#### Scenario: Run history, Preview, and Share collapse into the overflow menu
- **WHEN** the current user owns the pipeline (Share available) and opens the footer's "More actions" menu
- **THEN** "Run history", "Preview", and "Share" are listed as menu items, and none of the three renders as its own always-visible button

### Requirement: PipelineDetailPage shows persistent last-run metadata bar
The page footer SHALL display the persisted last-run information from `currentPipeline`:
relative timestamp, row count (locale-formatted), and status badge. This information SHALL
appear only when `currentPipeline.lastRunAt` is non-null, as part of the single footer region
(not a separate bar). When `lastRunAt` is null, no last-run information is shown in the footer
and no "Never run" placeholder is shown (the never-run state is communicated in the list view).

#### Scenario: Last-run metadata is visible when pipeline has run
- **WHEN** `currentPipeline.lastRunAt` is a non-null ISO-8601 string
- **THEN** the footer shows the relative timestamp, row count, and status, accessible via a "Last run metadata" label

#### Scenario: Last-run metadata is absent when pipeline has never run
- **WHEN** `currentPipeline.lastRunAt` is null
- **THEN** no last-run metadata element is rendered in the footer

#### Scenario: Last-run metadata shows relative timestamp
- **WHEN** the footer's last-run metadata is rendered
- **THEN** the last-run time is displayed in relative format (e.g. "2 hours ago")

#### Scenario: Last-run metadata shows row count
- **WHEN** `currentPipeline.lastRunRowCount` is non-null
- **THEN** the count is shown with locale formatting (e.g. "4,200 rows")

#### Scenario: Last-run metadata shows status badge
- **WHEN** `currentPipeline.lastRunStatus` is "succeeded" or "failed"
- **THEN** the appropriate status badge is rendered in the footer's last-run metadata

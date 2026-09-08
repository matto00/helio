## Purpose
Defines the frontend pipeline editor page (`/pipelines/:id`), which provides a visual editor
for viewing and modifying pipeline transformation steps.

## Requirements

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

### Requirement: Back navigation to pipeline list
The pipeline detail page SHALL provide a back navigation affordance that links to `/pipelines`.

#### Scenario: Back link is present and correct
- **WHEN** `PipelineDetailPage` is rendered
- **THEN** a link element pointing to `/pipelines` is visible on the page

### Requirement: Source selector bar loads from API
The page header SHALL display the pipeline's bound data source(s), read-only, as one chip per
entry in `currentPipeline.roots` (in `position` order), inside a compact field group. Past
`MAX_VISIBLE_SOURCE_CHIPS` (3) chips, the remaining roots collapse into a "+N more" overflow
popover rendering the same chips. Each chip's name is a link (when its source resolves — see
below) that navigates to that specific root's source; a chip is not merely a label naming
`roots[0]`. The removed scalars `sourceDataSourceName`/`sourceDataSourceId` SHALL NOT be read.

When `roots` is empty or absent, the header SHALL render no source chips and no kind badge, and
SHALL NOT throw.

Each chip carries its own remove ("×") control, disabled when the pipeline has exactly one root
(the server refuses removing the last root). A kind badge (CSV / REST API / SQL / Static) renders
on a chip ONLY when the pipeline has exactly one root — at 2+ roots no chip shows a kind badge, to
keep the row from growing heavier exactly when space is tightest.

The header SHALL NOT offer per-source toggling or a preview affordance. When a root's matching
`DataSource` is resolvable (i.e. the current user owns it) AND the pipeline has exactly one root,
an "Edit source" action SHALL additionally be available in the header's single actions menu (see
"Header actions consolidate into one menu" below), gated identically to the chip; at 2+ roots this
singular menu item is omitted (which root it would mean is ambiguous) and each chip's own name is
the per-root way to reach that source. When a root's source isn't resolvable, its chip renders as
plain non-interactive text (never a dead link) and never contributes a kind badge.

The user-facing label for a root is "source" everywhere in this header (aria-labels, menu items,
toast copy) — "root"/"PipelineRoot" remain the internal names only (HEL-1022).

#### Scenario: Bound source name and kind are rendered
- **WHEN** the pipeline has exactly one root and `state.sources.items` contains a DataSource whose
  id matches that root's `dataSourceId`
- **THEN** the page header shows a chip with that source's name and its kind label

#### Scenario: Multiple roots render as multiple chips
- **WHEN** the pipeline has three roots
- **THEN** the page header shows three source chips, each naming its own root's data source, and
  none of them shows a kind badge

#### Scenario: Chips past the visible limit collapse into overflow
- **WHEN** the pipeline has more than three roots
- **THEN** the header shows the first three as chips and a "+N more" control exposing the rest

#### Scenario: Bound source name renders without a kind badge when unresolved
- **WHEN** the pipeline has exactly one root and no DataSource in `state.sources.items` matches
  its `dataSourceId`
- **THEN** the page header shows that chip's source name with no kind badge

#### Scenario: Header renders safely when the pipeline has no roots
- **WHEN** `currentPipeline.roots` is empty or absent
- **THEN** the header renders without a source chip or kind badge and no error is thrown

#### Scenario: Edit source action shown when the current user owns the sole source
- **WHEN** the pipeline has exactly one root, `state.sources.items` contains a DataSource whose id
  matches that root's `dataSourceId`, and the user opens the header's actions menu
- **THEN** an "Edit source" menu item is visible

#### Scenario: Edit source action hidden when the current user does not own the source
- **WHEN** the pipeline has exactly one root and no DataSource in `state.sources.items` matches
  its `dataSourceId` (e.g. the pipeline was shared with the current user by a pipeline-sharing
  grant, but the underlying source belongs to someone else), and the user opens the header's
  actions menu
- **THEN** no "Edit source" menu item is rendered

#### Scenario: Edit source menu item is omitted with multiple roots
- **WHEN** the pipeline has two or more roots and the user opens the header's actions menu
- **THEN** no singular "Edit source" menu item is rendered, regardless of ownership

#### Scenario: Activating Edit source navigates to the source detail page
- **WHEN** the user opens the header's actions menu and activates "Edit source" (single-root case),
  or clicks a chip's linked name
- **THEN** `sources.selectedSourceId` is set to that source's id and the app navigates to `/sources`

### Requirement: River view empty state
When no transformation steps have been added, the river view SHALL display an empty state message containing "Add your first transformation step".

#### Scenario: Empty state shown with no steps
- **WHEN** the pipeline detail page is first rendered (steps array is empty)
- **THEN** the text "Add your first transformation step" is visible

### Requirement: Adding a transformation step
The user SHALL be able to add a transformation step. After adding, the step SHALL appear in the river view and the empty state SHALL no longer be visible.

#### Scenario: Step appears after adding
- **WHEN** the user triggers the add-step action
- **THEN** a new step card appears in the river view

### Requirement: Removing a transformation step
The user SHALL be able to remove a transformation step from the river view. After removal, the step SHALL no longer appear in the list.

#### Scenario: Step removed after removal action
- **WHEN** the user removes an existing step
- **THEN** that step is no longer visible in the river view

### Requirement: Editable output name in footer
The footer bar SHALL display the pipeline's own name field (not a bound output-type name). The
user SHALL be able to edit the pipeline name inline.

#### Scenario: Output name is editable
- **WHEN** the user activates the pipeline name field
- **THEN** an input element is rendered allowing the name to be changed

### Requirement: Run pipeline button shows placeholder
The "Run pipeline" and "Dry run" buttons in the footer bar SHALL trigger a real pipeline run over
SSE (this requirement no longer describes a placeholder; superseded by the shipped `pipeline-run-sse`
and `pipeline-dry-run-ui` capabilities).

#### Scenario: Run button shows placeholder on click
- **WHEN** the user clicks the "Run pipeline" button
- **THEN** a live run is submitted and its status streams via SSE, not a placeholder message

### Requirement: Pipeline detail page shows loading state while fetching
`PipelineDetailPage` SHALL display a loading indicator while `fetchPipelineById` or
`fetchPipelineSteps` is in the `"loading"` state. The main content SHALL not be rendered
until data is available.

#### Scenario: Spinner visible during fetch
- **WHEN** `PipelineDetailPage` is mounted and the API call is pending
- **THEN** a loading indicator is visible and the pipeline content is not rendered

### Requirement: Pipeline detail page shows error state on fetch failure
`PipelineDetailPage` SHALL display an error message when `fetchPipelineById` fails,
rather than rendering the editor.

#### Scenario: Error message shown on pipeline load failure
- **WHEN** `fetchPipelineById` rejects
- **THEN** an error message is shown instead of the editor

### Requirement: Pipeline name is loaded from Redux state
`PipelineDetailPage` SHALL use `currentPipeline.name` from Redux (populated via `fetchPipelineById`)
as the initial value for the output name field, replacing the previous fallback to the URL id.

#### Scenario: Output name initialized from API response
- **WHEN** `fetchPipelineById` succeeds
- **THEN** the output name field is initialized with `currentPipeline.name`

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

### Requirement: Bound-type bar displays the pipeline's output DataType
The page header SHALL show source, schedule, run status, and the pipeline's total Outputs count
("Outputs (N)"). The "Output type" link and any DataType-bound header field are removed; the page
SHALL NOT fetch `state.dataTypes.items` or reference the retired `outputDataTypeName`/`output_data_type_id` fields.

#### Scenario: Page header shows the output type name
- **WHEN** `PipelineDetailPage` is rendered with a loaded `currentPipeline` that has 4 Outputs
- **THEN** the page header shows "Outputs (4)" and no "Output type" link is present

### Requirement: Pipeline-sharing role does not grant source/type edit access
A pipeline-sharing `editor` or `viewer` grant (see `pipeline-sharing`) confers no ownership of the
pipeline's bound DataSource. The "Edit Source" button SHALL be gated solely on DataSource ownership
(presence in the current user's owner-scoped `sources.items`), never on pipeline ownership or
pipeline-sharing role alone. (The output-DataType half of this requirement is removed along with
the DataType concept — see `pipeline-output-type-selector`'s REMOVED Requirements.)

#### Scenario: Shared pipeline editor without source ownership sees no Edit Source button
- **WHEN** the current user has an `editor` grant on the pipeline but does not own its bound
  DataSource (it is absent from `state.sources.items`)
- **THEN** no "Edit Source" button is rendered, even though the user can edit pipeline steps

### Requirement: Steps can be inserted between existing steps in the editor

The pipeline editor SHALL offer an "insert step here" affordance in each gap of the step list —
before the first step card and between each adjacent pair (appending after the last step remains
the existing add-step row). The affordance SHALL:

- Open the existing op-type picker anchored at that gap; selecting an op creates the step at that
  list index via the create endpoint's optional `position`
- Reflect the inserted step immediately at the chosen position (optimistic), reconciling with the
  persisted step on success; on failure, keep the local step and surface a visible error (the
  editor's existing add-step failure convention)
- Leave the existing append flow unchanged
- Trigger the editor's existing analyze refresh (and thereby per-step validation/preview updates)
  after the insert settles

#### Scenario: Insert before the first step

- **WHEN** the user activates the insert affordance above the first step card and picks an op
- **THEN** the new step appears first, the previously-first step moves to second, and the order
  persists across reload

#### Scenario: Insert between two steps

- **WHEN** the user activates the insert affordance between step cards A and B and picks an op
- **THEN** the new step appears between A and B, later steps shift down by one, and the order
  persists across reload

#### Scenario: Append is unchanged

- **WHEN** the user adds a step via the existing bottom add-step control
- **THEN** the step is appended at the end exactly as before

#### Scenario: Analyze refreshes after an insert

- **WHEN** a step is inserted between existing steps
- **THEN** the pipeline re-analyzes without manual action and downstream steps' schemas/validation
  reflect the new upstream step

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

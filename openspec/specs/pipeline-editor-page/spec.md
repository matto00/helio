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

- Open the add-step palette carrying that gap's insert context; selecting a step creates it at that
  gap, directly after the persisted step that precedes the gap (or first, for the gap before the first
  step)
- Reflect the inserted step immediately at the chosen position (optimistic), reconciling with the
  persisted step on success; on failure, keep the local step and surface a visible error (the
  editor's existing add-step failure convention)
- Leave the existing append flow unchanged
- Trigger the editor's existing analyze refresh (and thereby per-step validation/preview updates)
  after the insert settles

After a trunk create succeeds — whether the step was created immediately or as a deferred draft
once its config became complete — the editor SHALL bring every step the create touched in line with
the server in the same update that replaces the local placeholder: the created step takes its
persisted fields, and every step the server reports as reparented shows the created step as its
parent. That update SHALL keep every local-only step (one not yet persisted, including another draft
or another create still in flight), SHALL NOT change any step the create did not touch, SHALL keep a
draft's stable render key so its open card stays open, and SHALL NOT replace any step's local config.
The created step SHALL appear exactly once, and no step SHALL leave the rendered lane while it settles.

An insert's placement SHALL be anchored on the persisted step that precedes the chosen gap (local-only
steps are not counted), identified by that step and never by a list index, so it does not go stale
while the insert waits for its create or while other inserts complete. If that step no longer exists
when the create is sent, the step SHALL be appended at the trunk's end rather than rejected. A step
the server created SHALL appear on screen even if another update replaced the step list while its
create was in flight, unless the user removed it.

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
- **THEN** the step is appended at the end exactly as before, and it is still at the end after
  reload

#### Scenario: Analyze refreshes after an insert

- **WHEN** a step is inserted between existing steps
- **THEN** the pipeline re-analyzes without manual action and downstream steps' schemas/validation
  reflect the new upstream step

#### Scenario: A draft created at an insert position resyncs reparented steps

- **WHEN** a draft step inserted between A and B becomes complete and its create succeeds, and the
  server reparents B under the created step
- **THEN** without a reload, B's local parent is the created step, matching the server

#### Scenario: The post-create update keeps local-only steps

- **WHEN** a trunk create succeeds while another draft step exists only locally (never sent, or its
  create still in flight)
- **THEN** that other draft step is still on screen with its config, and its own later create still
  replaces it in place

#### Scenario: The post-create update keeps an open card open

- **WHEN** a draft's create succeeds
- **THEN** the created step's card stays expanded and keeps any edit made while the create was in
  flight

#### Scenario: An immediately-created step appears exactly once without hiding other steps

- **WHEN** the user inserts a step whose kind is created immediately, before the first step or
  between two steps, and the create succeeds
- **THEN** exactly one card for that step is on screen, every other step of the lane stays rendered
  with any open card still open, and steps the server reparented show their persisted parent

#### Scenario: Overlapping creates neither duplicate nor drop a step

- **WHEN** the user starts a second insert at the same gap while the first insert's create is still
  in flight
- **THEN** each created step appears exactly once, each open card stays open, and every step shows the
  parent the server persisted (the step order matches the server's)

#### Scenario: A draft completed after its trunk shrank is still created

- **WHEN** a draft is inserted between the second and third steps, the second step is then deleted,
  and the draft's config is completed
- **THEN** the draft is created (appended at the trunk's end when its anchor is gone, otherwise
  directly after its anchor) and no create is rejected for an out-of-range position

#### Scenario: Inserts at different gaps land where each was chosen

- **WHEN** the trunk is A, B, C, the user inserts X between A and B, and while X's create is in flight
  inserts Y between B and C
- **THEN** after both creates complete, in either response order, the server and the screen both show
  A, X, B, Y, C

#### Scenario: A created step is not lost to a concurrent list refresh

- **WHEN** an insert's create is in flight and another action (for example duplicating a step)
  replaces the step list before the create completes
- **THEN** once the create completes, the created step is on screen exactly once and the steps it
  reparented show it as their parent

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

### Requirement: A step card cannot be expanded while its create is in flight

When the editor shows a step optimistically, before the server has confirmed it (append, insert-between, or lane
add), that step card's expand control SHALL be disabled until the persisted step replaces the optimistic one.
Opening the editor or editing the step SHALL NOT be possible during that window, so no open editor is collapsed
and no edit is discarded when the step is reconciled. If the create fails, the expand control SHALL become enabled
again, so the user can open the card and use its existing controls, including Remove. A step that the editor
deliberately keeps local until its configuration is complete (an AI draft step) SHALL remain expandable.

#### Scenario: Expand is unavailable until the added step is persisted

- **WHEN** the user adds a step and the server has not yet confirmed it
- **THEN** that step card's expand control is disabled, and activating it does not open the editor

#### Scenario: Expand works once the step is persisted

- **WHEN** the server confirms the added step and the editor has reconciled it
- **THEN** the step card's expand control is enabled, opening it shows the step's editor, and an edit made there is
  saved to the persisted step

#### Scenario: A failed create leaves the step expandable

- **WHEN** creating the added step fails
- **THEN** the editor shows its existing failure message, keeps the local step, and the step card's expand control
  is enabled

#### Scenario: AI draft steps remain editable before creation

- **WHEN** the user adds an AI step that stays a local draft until its configuration is complete
- **THEN** its step card's expand control is enabled and its editor can be opened and edited

### Requirement: Pipeline detail boot requests are bounded

Opening the pipeline detail page SHALL NOT issue more than one GET of the same resource for the same pipeline per page
open, in development (including React StrictMode) and production builds alike. The page SHALL NOT fetch the
pipeline's run history on open unless something rendered on first paint needs it. The only first-paint consumer is the
persisted truncation banner, which renders only when the pipeline's last run is recorded as truncated. Run history
SHALL instead be fetched when the user opens the run-history modal, at least once per page open (a list loaded on an
earlier visit SHALL NOT be shown without being refetched), and refreshed after a run the page started or observed
finishes, as before; that refresh SHALL NOT be dropped because another run-history fetch is in flight, and an older
response SHALL NOT overwrite a newer one. Every first-paint element the page showed before this requirement (header, schedule
summary, bound sources, river view, Outputs tab with its count, footer last-run metadata) SHALL render unchanged.

#### Scenario: Run history is fetched at most once on open
- **WHEN** the user opens the detail page of a pipeline whose last run was truncated
- **THEN** exactly one run-history GET is issued for that pipeline during the page open, and the persisted truncation
  notice renders

#### Scenario: Run history is not fetched on open when nothing needs it
- **WHEN** the user opens the detail page of a pipeline whose last run was not truncated (or that has never run)
- **THEN** no run-history GET is issued until the user opens the run-history modal

#### Scenario: Opening run history fetches it
- **WHEN** the user opens the run-history modal and run history has not been loaded for this page open
- **THEN** the run history is fetched and its runs render in the modal

#### Scenario: A StrictMode revisit still issues one run-history GET
- **WHEN** the user revisits, in the same session and under React StrictMode, the detail page of a pipeline whose last
  run was truncated
- **THEN** exactly one run-history GET is issued for that page open

#### Scenario: A response from an earlier visit does not count for a later one
- **WHEN** a run-history fetch is still in flight as the user leaves the page (including an in-place switch to another
  pipeline and back), lands afterwards, and the user returns and opens the run-history modal
- **THEN** a new run-history GET is issued for the new page open before any runs are listed

#### Scenario: Switching pipelines in place closes the run-history modal
- **WHEN** the run-history modal is open and the page switches in place to another pipeline (sidebar, picker, or
  browser Back)
- **THEN** the modal closes, and no pipeline's runs are shown under another pipeline's page

#### Scenario: A failed fetch is retried only on request
- **WHEN** the run-history modal shows its error state
- **THEN** no further run-history GET is issued until the user activates Retry, and each Retry issues exactly one

#### Scenario: Run history is refetched on a later page open
- **WHEN** the user opens the run-history modal, leaves the page (by navigating away, or in place to another pipeline),
  returns to the same pipeline, and opens the modal again
- **THEN** a new run-history GET is issued on the second visit, and the first visit's list is not shown before it

#### Scenario: The run-history modal does not claim emptiness while loading
- **WHEN** the run-history modal is open and its fetch is still in flight
- **THEN** the modal shows a loading state, its title carries no run count, and it does not show "No runs recorded yet"

#### Scenario: A failed run-history fetch is reported
- **WHEN** the run-history modal is open and its fetch fails
- **THEN** the modal shows an error state, its title carries no run count, and it does not show "No runs recorded yet"

#### Scenario: A run finishing during an in-flight fetch still refreshes
- **WHEN** a run-history fetch is in flight and a run started or observed on the page reaches a terminal status
- **THEN** a further run-history fetch is issued, and the list shown reflects that later fetch even if the earlier
  response arrives last; a list already shown in this page open stays visible while the refresh is in flight

#### Scenario: A finished run still refreshes run history
- **WHEN** a run started or observed on the page reaches a terminal status
- **THEN** run history is refreshed, so an open or later-opened modal lists that run

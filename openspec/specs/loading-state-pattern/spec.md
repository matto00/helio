# loading-state-pattern Specification

## Purpose
Canonical loading-state pattern (DESIGN.md §7): which surfaces render a shape-matched skeleton on
initial load, the no-layout-shift and initial-load-only rules that govern them, the division between a
skeleton for initial structural load and the accent border-spinner for short in-place refresh, and the
bounded, explicitly-stated deltas where a resolved geometry is not knowable before its fetch completes.
## Requirements
### Requirement: Named surfaces render a skeleton on initial load
The system SHALL render skeleton placeholders, composed from the shared `Skeleton` primitive, while an
initial data load is in flight on each of `PanelList` (in place of `PanelGrid`), `SidebarItemList`,
`DashboardList`, `PipelineDetailPage`, `SourceDetailPanel`'s preview section, `PanelContent`,
`SourcesPage`, `PipelinesPage`, and `TypeRegistryPage`. No listed surface SHALL render an empty region,
a bare one-line text label, or its resolved-but-empty content while that load is in flight.

#### Scenario: Each named surface shows skeletons during its initial load
- **WHEN** any of the named surfaces is mounted with its data fetch in flight and no prior data
- **THEN** it renders skeleton placeholders

#### Scenario: The dashboard grid area is never empty during load
- **WHEN** the panel list is loading for a selected dashboard and no panels have arrived yet
- **THEN** panel-card-shaped skeleton placeholders occupy the grid area

#### Scenario: No surface renders a bare text-line loading label
- **WHEN** any of the named surfaces is loading
- **THEN** its loading state is not a single line of text standing alone in place of the content

### Requirement: A skeleton matches the shape and size of the content it replaces
Each skeleton placeholder SHALL be composed so that the container it occupies has the same geometry as
the resolved content that replaces it, so no layout shift occurs on resolve. Placeholders SHALL be
rendered inside the same wrapper element and CSS classes as the resolved content wherever that content
is a list or grid, so that padding, gap and row rhythm are inherited from a single stylesheet rather
than duplicated. A full-surface skeleton that stands in for a state which can also render an
`EmptyState` of the `main` variant SHALL respect that variant's minimum height, so that a transition
between the loading state and an error or empty state does not collapse the surface.

Where the resolved content is a collection whose length is not knowable before the fetch completes, the
per-row or per-card geometry SHALL match exactly — row height, gap, padding, border radius and
horizontal geometry, all inherited from the resolved content's own wrapper and classes — while the
*number* of placeholders rendered MAY differ from the number of resolved rows. That count difference is
a stated, documented delta rather than a violation, and the container SHALL NOT collapse below the
minimum height its sibling empty and error states occupy.

#### Scenario: No layout shift in per-row geometry when content resolves
- **WHEN** a surface's skeleton state is replaced by its resolved content
- **THEN** the per-row geometry — height, gap, padding, radius and horizontal position — is unchanged by
  the swap

#### Scenario: A differing placeholder count is not a violation
- **WHEN** a collection resolves to a different number of rows than the skeleton rendered placeholders
- **THEN** the difference in total container height attributable solely to that count is accepted, and
  the container still does not collapse below its empty/error-state minimum height

A full-surface skeleton composed of multiple bands (a header, a body, and a footer, as
`PipelineDetailSkeleton` is) SHALL keep its outer container's geometry stable across the swap even where
one or more inner bands do not match exactly, when that band's real content is conditionally rendered or
of unbounded, data-dependent length that is not knowable before the fetch completes — the same "bound
rather than exact match" concession this requirement already makes for a differing placeholder count.

#### Scenario: A band whose content presence or length is unknowable pre-fetch accepts a documented delta
- **WHEN** a multi-band full-surface skeleton is replaced by resolved content whose per-band height depends
  on data unknowable before the fetch completes (an optional band that only renders for some results, or a
  band whose content wraps across an unbounded, data-dependent number of lines)
- **THEN** the outer container's geometry is unchanged by the swap
- **AND** the affected band's height difference is an accepted, documented delta rather than a violation

#### Scenario: List skeleton rows reuse the real list wrapper
- **WHEN** a sidebar or panel list renders its skeleton rows
- **THEN** those rows are laid out by the same wrapper class as the resolved rows

#### Scenario: A loading-to-error transition does not collapse the surface
- **WHEN** a full-surface load fails and its error state replaces the skeleton
- **THEN** the surface does not collapse to a shorter height in between

### Requirement: Skeletons are shown for initial loads only, never for refreshes over existing content
A surface that already has content SHALL continue rendering that content while a subsequent fetch is in
flight, rather than replacing it with skeletons. For a surface driven by a Redux `status` field that
flips to `"loading"` on every fetch, the initial-load condition SHALL be that status combined with an
absence of already-loaded items; for a surface driven by data presence, the existing data-presence check
SHALL serve as that condition.

There is one deliberate exception, which SHALL be preserved rather than treated as a violation: a panel
whose bound data type is invalidated by a completed pipeline run has its cached rows cleared, so it
genuinely re-enters the initial-load state and renders a full skeleton takeover. This is the same
structural treatment that path renders today (a full-panel spinner takeover), so it is not a regression;
it is recorded here so the behaviour is locked deliberately rather than contradicted silently. Changing
it would require preserving the cached rows behind a staleness flag, which is a change to panel refresh
semantics and is out of scope for this capability.

#### Scenario: A refetch over existing content keeps rendering it
- **WHEN** a list that already holds items begins a subsequent fetch
- **THEN** the existing items remain rendered and no skeleton replaces them

#### Scenario: A first load with no prior items renders skeletons
- **WHEN** a list with no items begins its first fetch
- **THEN** skeleton rows are rendered

#### Scenario: A pipeline run that invalidates a panel's data re-enters the initial-load state
- **WHEN** a completed pipeline run invalidates the data type a rendered panel is bound to, clearing that
  panel's cached rows, and the panel refetches
- **THEN** the panel renders its skeleton state for that fetch, matching the treatment it renders on a
  first load

### Requirement: The panel body skeleton is kind-agnostic and shared with the chunk-load fallback
The panel body's loading skeleton SHALL be a single component that fills its container and does not vary
by panel kind, so that the same component can serve both the panel's data-load state and the lazily
loaded renderer's `Suspense` fallback. The fallback component receives no panel and cannot determine the
kind, and the two are rendered into different boxes — the data-load state replaces the whole panel body
while the chunk fallback is nested inside the renderer's own canvas — so a kind-shaped skeleton could not
present identically in both, which is the invariant this sharing exists to preserve. No layout shift is
introduced by this, because the card's own box is fixed by its grid cell rather than by its body content.

#### Scenario: The data-load and chunk-load states present identically
- **WHEN** a panel's data-load skeleton and the same panel's renderer chunk-load fallback are compared
- **THEN** they present the same loading treatment

#### Scenario: The body skeleton does not vary by panel kind
- **WHEN** the panel body skeleton is rendered for panels of different kinds
- **THEN** it renders the same treatment for each, filling its container

### Requirement: Short in-place work continues to use the accent border-spinner
The system SHALL continue to use the existing accent border-spinner, not a skeleton, for short in-place
work that occurs over already-rendered structure — specifically the table panel's paginated "load more",
`SourceDetailPanel`'s preview button label, the assistant's in-flight send indicator, the refinement
drawer's progress row, and the route-level `Suspense` fallback. No such indicator SHALL be replaced by a
skeleton, and panel polling behaviour SHALL NOT regress.

#### Scenario: Paginated load-more keeps its spinner
- **WHEN** a table panel fetches an additional page while rows are already rendered
- **THEN** the existing rows remain and the load-more control shows the accent border-spinner

#### Scenario: The route-level suspense fallback keeps its spinner
- **WHEN** a lazily-loaded route's chunk is fetching
- **THEN** the page-level fallback renders the accent border-spinner

### Requirement: The skeleton-versus-spinner division is documented in code
The `Skeleton` primitive SHALL carry a comment stating the division the system follows: a skeleton
indicates an initial structural load, where a region has no prior content and its resolved size is
predictable, and the accent border-spinner indicates short in-place work over existing structure.

#### Scenario: The division is stated on the primitive
- **WHEN** `Skeleton.tsx` is read
- **THEN** a comment states that a skeleton is for first load and the spinner is for in-place refresh

### Requirement: Sidebar sections whose rows are taller receive their row shape from the call site
`SidebarItemList` SHALL accept the shape of its rows from its call site rather than inferring it, because
during an initial load it holds no items from which to infer it. The data-types section, whose resolved
rows carry a subtitle and are therefore taller than a standard row, SHALL render skeleton rows of that
taller shape, so the section does not shift when its content resolves.

#### Scenario: A subtitle-bearing section renders taller skeleton rows
- **WHEN** the data-types sidebar section renders its initial-load skeleton
- **THEN** its skeleton rows match the height of the two-line rows that replace them

#### Scenario: Standard sections render single-line skeleton rows
- **WHEN** a sidebar section whose rows carry no subtitle renders its initial-load skeleton
- **THEN** its skeleton rows match the height of the single-line rows that replace them

### Requirement: The dashboard grid skeleton approximates the resolved layout and never renders zero cards
The panel-grid skeleton SHALL derive its placeholder cards from the selected dashboard's saved layout for
the active breakpoint, positioned and sized by the same grid configuration the resolved grid uses, so
that each placeholder occupies the cell its panel will occupy. The resolved grid renders a *resolved*
layout — the saved layout with a fallback position filled in for every panel absent from it, projected
across breakpoints — and the saved layout is frequently empty, because a client-generated layout is not
persisted until a real drag or resize changes the geometry. The skeleton therefore SHALL render a
documented, non-zero number of placeholder cards whenever the saved layout for the active breakpoint has
no entries, and SHALL NOT render an empty grid area in that case. Placeholder geometry SHALL be produced
by the same layout-resolution the grid itself applies, given synthetic stand-in panels, rather than read
directly from the saved layout array or hand-placed — so that the default width and packing rule, and
the projection of a populated breakpoint onto an empty one, are all inherited rather than reimplemented.
Because the panel count is not derivable before the panels fetch resolves, a bounded difference in
placeholder **count** is accepted. Per-card geometry SHALL match exactly for the placeholders rendered
when the saved layout for the active breakpoint either fully covers the panel set or has no entries at
all — the two cases in which the resolver's placement for every panel is determined by the saved layout
alone. When the saved layout only *partially* covers the panel set, the resolver (`findNextAvailablePosition`)
displaces the saved-position panels beyond that coverage into free space to make room for the panels it
must still place, and — because the panel count is unknown pre-fetch, the same fact that licenses the
count delta above — which real panels the skeleton's synthetic stubs stand in for, and therefore which
saved-position panels end up displaced and by how much, cannot be predicted before the fetch resolves
either. In that partial-coverage case the placeholders matching the covered prefix SHALL still match
exactly; the position and size delta for the displaced remainder is an accepted, documented consequence
of resolver-derived placement, not a defect. The skeleton SHALL be rendered inside
the same zoom-transform wrapper as the resolved grid, so a saved zoom level other than 1 does not
displace the content on resolve.

#### Scenario: A fully covered saved layout produces an exact match
- **WHEN** the panel grid renders its initial-load skeleton for a dashboard whose saved layout covers
  every panel
- **THEN** one placeholder is rendered per layout entry, at that entry's position and size

#### Scenario: An empty saved layout still renders placeholder cards at the resolver's own default geometry
- **WHEN** the panel grid renders its initial-load skeleton for a dashboard whose saved layout for the
  active breakpoint has no entries
- **THEN** a non-zero number of placeholder cards is rendered, and the grid area is not empty
- **AND** each placeholder's width and position match what the grid's own layout resolution would assign
  a panel by default at that breakpoint

#### Scenario: An empty active breakpoint projected from a populated one is matched
- **WHEN** the active breakpoint's saved layout has no entries but another breakpoint's does, so the
  resolved grid projects that breakpoint's positions onto the active one
- **THEN** the skeleton's placeholders are derived through the same projection, not from the empty saved
  array

#### Scenario: A partially covered saved layout matches its covered prefix exactly and accepts a positional delta beyond it
- **WHEN** the panel grid renders its initial-load skeleton for a dashboard whose saved layout for the
  active breakpoint covers only some of its panels, so the resolver displaces the saved-position panels
  beyond that coverage to make room for the rest
- **THEN** the placeholders matching the covered prefix match the resolved cards exactly
- **AND** the resolved position and size of the displaced remainder MAY differ from the corresponding
  placeholders, and that difference is accepted rather than treated as a layout-shift violation

#### Scenario: A non-default zoom level does not displace the swap
- **WHEN** the grid skeleton is replaced by the resolved grid at a saved zoom level other than 1
- **THEN** the content is not displaced by the zoom factor

### Requirement: The phone panel stack renders a skeleton with a bounded, accepted height difference
The system SHALL render a stack-shaped skeleton, rather than nothing, on the stacked panel list the
dashboard renders below the phone breakpoint, at the stack's own width and spacing, so that the
horizontal geometry does not shift on resolve. Its placeholder count SHALL be derived the same way the
grid's is — through the grid's own layout resolution over synthetic stand-in panels, including the
non-zero fallback when the active breakpoint's saved layout has no entries. The phone breakpoint is the
one most often stored empty, so a count read directly from the saved array would render nothing at all
here. That
stack's per-card height depends on each panel's kind, which is not known until the panels fetch resolves,
so a per-card height difference on resolve is accepted on this surface only — it is not derivable before
the fetch completes.

#### Scenario: The phone stack renders placeholders rather than an empty region
- **WHEN** the dashboard is loading at a phone width
- **THEN** stack-shaped placeholders are rendered, not an empty region

#### Scenario: Card width and horizontal geometry do not shift on the phone stack
- **WHEN** the phone stack's skeleton is replaced by the resolved cards
- **THEN** the cards' width and horizontal position are unchanged, and the card count matches whenever
  the saved layout covers the panel set

### Requirement: The pre-dispatch idle frame never paints an empty state before the skeleton
A surface that mounts before its own fetch has been dispatched SHALL render its skeleton on that first
painted frame, not its empty state. Because a mount effect runs after paint, a condition keyed only on an
in-flight status paints the empty branch first and the skeleton one commit later, which is a flash of
empty content ahead of the loading state. The initial-load condition SHALL therefore treat "not yet
resolved" — an unstarted or in-flight fetch with no loaded items — as the loading state.

A surface whose fetch may never be dispatched at all, or whose unstarted state is re-entrant rather than
reached only once before the first fetch, SHALL NOT use that widened condition unless it can tell the two
apart, since it would otherwise render a skeleton indefinitely.

For the sidebar resource sections, whose fetches are dispatched only for the active section and are
skipped entirely for a section the current user's tier excludes, the initial-load condition SHALL be
supplied by the call site that owns that dispatch decision, rather than inferred inside the shared list
component.

For the panel list, whose unstarted state is re-entrant — it is restored when a dashboard's panels are
invalidated, and the fetch that would clear it is dispatched by an ancestor keyed only on the selected
dashboard — the panel state SHALL record which dashboard was invalidated, and SHALL clear that record when
a fetch begins. With that record present the two unstarted states are distinguishable, and the panel
list's initial-load condition SHALL admit the unstarted state only when the selected dashboard is **not**
the recorded invalidated one, so that no pre-dispatch frame paints blank and no invalidated state parks a
permanent skeleton.

The panel list SHALL still render no skeleton in either state where no fetch is pending or coming: when
no dashboard is selected, and when the selected dashboard's panels have been invalidated or emptied
without a refetch being scheduled. In the first it renders its existing empty state and create-dashboard
action. In the second it renders the panel-area empty state and its create-panel action, per the
panel-empty-state capability.

#### Scenario: The first painted frame shows the skeleton, not the empty state
- **WHEN** a surface whose unstarted state is reached only once mounts with its fetch not yet dispatched
  and no loaded items
- **THEN** its first painted frame renders the skeleton, and its empty state is not rendered

#### Scenario: A section whose fetch is never dispatched does not render a permanent skeleton
- **WHEN** a sidebar section's fetch is skipped because the section is not active or is excluded for the
  current user's tier
- **THEN** that section does not render a skeleton indefinitely

#### Scenario: No dashboard selected renders the empty state and its call to action
- **WHEN** no dashboard is selected, so no panel fetch is dispatched
- **THEN** the panel list renders its empty state and its create-dashboard action, and no skeleton

#### Scenario: Emptying a dashboard's panels does not leave a permanent skeleton
- **WHEN** the last panel on the selected dashboard is deleted, returning the panel list to its unstarted
  state with no refetch scheduled
- **THEN** no skeleton is rendered

#### Scenario: The panel list's pre-dispatch frame renders the skeleton
- **WHEN** a dashboard is selected, the panel list is unstarted with no loaded items, and that dashboard
  is not the recorded invalidated one, so a fetch is about to be dispatched
- **THEN** the skeleton renders on that frame, and neither an empty state nor a blank region is painted

### Requirement: A panel body renders its skeleton before its own data fetch is dispatched
The panel body SHALL render its skeleton, not its renderer populated with absent data, on the frame
before its data fetch is dispatched. The panel data hook derives its in-flight flag from a cache entry
that does not exist until the fetch begins, and the fetch is dispatched from an effect that runs after
paint, so a condition keyed only on that in-flight flag paints the renderer with null data first — for a
metric panel that is a visible placeholder value and a "No data" label, which misstates data
availability while no request has been made. The loading condition SHALL therefore also treat "this
panel has a fetch target but no cache entry yet" as loading. That state is safe to treat as loading
because it is always followed by a dispatch: the hook returns early when there is no fetch target, and
its de-duplication guard is deliberately bypassed when the cache entry is absent. This SHALL apply
wherever the hook drives a panel body, including the panel detail modal.

#### Scenario: A panel body shows the skeleton before its fetch is dispatched
- **WHEN** a panel with a bound data target mounts and its data fetch has not yet been dispatched
- **THEN** the panel body renders its skeleton, and does not render its renderer with absent data

#### Scenario: A metric panel never shows a no-data signal before requesting data
- **WHEN** a bound metric panel mounts and its data fetch has not yet been dispatched
- **THEN** no placeholder value or no-data label is rendered

#### Scenario: The panel detail modal inherits the same behaviour
- **WHEN** a panel's detail modal opens and its data fetch has not yet been dispatched
- **THEN** its body renders the skeleton rather than a renderer with absent data

### Requirement: Switching dashboards renders the skeleton rather than the previous dashboard's panels
The panel list SHALL treat the arrival of a fetch for a different dashboard as an initial load, rendering
the skeleton, rather than continuing to render the previously selected dashboard's panels. The panels
state retains the previous dashboard's items while the new fetch is in flight, so an emptiness test that
only counts items would keep the stale panels on screen under the new dashboard's layout. The test SHALL
therefore be whether any loaded panel belongs to the currently selected dashboard.

#### Scenario: Selecting a different dashboard renders the skeleton
- **WHEN** a different dashboard is selected while the previous dashboard's panels are still loaded
- **THEN** the panel grid renders its skeleton, and the previous dashboard's panels are not rendered

#### Scenario: A refetch of the same dashboard keeps its panels rendered
- **WHEN** the currently selected dashboard's panels are refetched while already loaded
- **THEN** those panels remain rendered and no skeleton replaces them

### Requirement: Loading treatment is consistent across sibling surfaces
Sibling surfaces rendered in the same region SHALL present the same loading treatment as each other. In
particular the dashboards sidebar section and the other sidebar resource sections SHALL agree on whether
their list wrapper renders during load, so the sidebar does not present two different loading treatments
depending on the active route.

#### Scenario: All sidebar sections share one loading treatment
- **WHEN** each sidebar resource section is driven into its initial-load state
- **THEN** each renders the same skeleton treatment as the others


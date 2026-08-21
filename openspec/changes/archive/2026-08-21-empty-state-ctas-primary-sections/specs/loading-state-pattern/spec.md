## MODIFIED Requirements

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

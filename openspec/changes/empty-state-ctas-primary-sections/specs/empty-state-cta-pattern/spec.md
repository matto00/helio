## ADDED Requirements

### Requirement: Every primary section's page surface renders an EmptyState with a working primary action
Every primary workspace section SHALL render the shared `EmptyState` primitive on its **page surface**, in
the `main` variant, whenever it has no data to show, in every reachable no-data state, and SHALL NOT
render a blank region in any of them. The primary sections are Dashboards, Data Sources, Data Pipelines,
Type Registry, and the dashboard panel area.

Each such empty state SHALL offer exactly one primary call to action, rendered with the primary button
recipe, which performs the same operation as that section's existing create affordance elsewhere in the
application. A section whose resource cannot be created directly SHALL still offer an action, pointing at
the step that does produce it, rather than rendering no action at all.

The **sidebar** surfaces for these same sections SHALL render the primitive in its `sidebar` variant,
which is compact by design; the `main` variant applies to page surfaces only.

This requirement governs empty states that mean "there is no data". A surface that means "nothing is
selected yet", where the data exists and the resolution is to choose from a list already on screen, is a
selection prompt rather than an empty state, and SHALL NOT be required to carry a create action.

#### Scenario: A section with no data renders its empty state and action
- **WHEN** a primary section's page surface has resolved its fetch and has zero items
- **THEN** it renders an `EmptyState` in the `main` variant with a title, a description, and one primary
  call to action

#### Scenario: The action performs the same operation as the section's existing affordance
- **WHEN** the primary call to action in a section's empty state is activated
- **THEN** the same creation flow opens as when the create control **co-located with that empty state** is
  used
- **NOTE** a section may legitimately offer two different create flows on different surfaces — for example
  an immediate quick-create on the content pane and a named-create form in the sidebar. Each empty state
  matches its own surface's flow; this requirement does not collapse them into one.

#### Scenario: A section whose resource is produced indirectly points at the producing step
- **WHEN** a section's resource cannot be created directly, because it exists only as another step's output
- **THEN** its empty state's action opens that producing step's creation flow, and no action claiming to
  create the resource directly is offered

#### Scenario: A selection prompt is not required to carry a create action
- **WHEN** a surface has data available but none of it selected
- **THEN** it renders an empty state explaining what to choose, and is not required to offer a create action

### Requirement: Filtered-to-zero is a distinct state from nothing-created-yet
A section whose list can be narrowed by a filter or search input SHALL distinguish "no items exist" from
"the current query matched nothing". Both SHALL render the `EmptyState` primitive; neither SHALL render a
bare paragraph. The filtered state SHALL name the query that produced it, SHALL use a title and icon
distinct from the no-data state's, and SHALL offer an action that clears the query. The distinction SHALL
be carried by title, icon and wording — never by color alone.

The filtered state SHALL NOT offer the section's create action, and the no-data state SHALL NOT offer a
clear-query action, since neither resolves the other's situation.

#### Scenario: A query matching nothing renders the filtered empty state
- **WHEN** a section holds at least one item and the active query matches none of them
- **THEN** an `EmptyState` renders whose description includes the query text, and whose action clears the
  query

#### Scenario: Clearing the query from the filtered empty state restores the list
- **WHEN** the clear action in the filtered empty state is activated
- **THEN** the query is reset and the section's items render again

#### Scenario: An empty section with no query renders the no-data empty state
- **WHEN** a section has zero items and no active query
- **THEN** the no-data empty state renders with its create action, and the filtered wording is not shown

### Requirement: Empty states are token-driven, themed, and reachable by keyboard
Every empty state in a primary section SHALL draw all color, spacing, typography and radius from design
tokens, with no hardcoded literals introduced. Its title SHALL use the display typeface in the `main`
variant. Its icon SHALL come from the single icon library. It SHALL render correctly in both light and
dark themes. Its actions SHALL be real buttons with accessible names, operable by keyboard, and SHALL meet
the minimum touch-target height at mobile widths on every surface that is rendered at those widths.

Because the sidebar column is hidden below the mobile breakpoint, the touch-target floor is verified on
the page surfaces, which are the ones rendered there.

#### Scenario: Empty-state actions meet the mobile touch-target floor
- **WHEN** a page-surface empty state's primary action is rendered at a viewport at or below the mobile
  breakpoint
- **THEN** the button's laid-out height is at least the minimum touch-target size

#### Scenario: Empty-state actions are keyboard operable and named
- **WHEN** an empty state's action receives keyboard focus and is activated
- **THEN** it exposes an accessible name and performs its action

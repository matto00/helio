## ADDED Requirements

### Requirement: A filter matching no dashboards renders an empty state, not a bare status line
When the dashboard filter narrows the list to zero visible rows, the sidebar SHALL render the shared
empty-state primitive in its sidebar variant, rather than a bare status paragraph. It SHALL name the
query that produced the result, SHALL use a title and icon distinct from the no-dashboards-yet state, and
SHALL offer an action that clears the filter and restores the list.

It SHALL NOT offer the create-dashboard action, which does not resolve a query that matched nothing; and
the no-dashboards-yet state SHALL NOT offer the clear-filter action, for the mirror-image reason.

#### Scenario: A query matching no dashboards renders the filtered empty state
- **WHEN** at least one dashboard exists, no dashboard is currently selected, and the active filter query
  matches none of the visible rows
- **THEN** the sidebar renders an empty state naming the query, with a clear-filter action and no
  create-dashboard action
- **NOTE** the no-selection condition is required because this capability's existing "active dashboard is
  always reachable regardless of filter" requirement pins the selected dashboard outside the filter, so
  with one selected the visible list is never empty

#### Scenario: Clearing from the filtered empty state restores the list
- **WHEN** the clear-filter action in that empty state is activated
- **THEN** the filter query resets and the dashboard rows render again

#### Scenario: Zero dashboards with no query keeps the first-run empty state
- **WHEN** no dashboards exist and the filter query is empty
- **THEN** the no-dashboards-yet empty state renders with its create-dashboard action, and the filtered
  wording is not shown

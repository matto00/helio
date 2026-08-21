# sidebar-dashboard-filter Specification

## Purpose
Real-time case-insensitive substring filter for the sidebar dashboard list. The active dashboard always remains visible regardless of the filter, and a clear button resets the input.
## Requirements
### Requirement: Filter input is always visible in the dashboard sidebar
The sidebar dashboard list SHALL display a text input above the list items at all times, regardless of how many dashboards exist, allowing users to type a query to narrow the visible list.

#### Scenario: Filter input is present with zero dashboards
- **WHEN** the dashboard list is empty
- **THEN** the filter input SHALL still be rendered and focusable

#### Scenario: Filter input is present with multiple dashboards
- **WHEN** the dashboard list contains one or more items
- **THEN** the filter input SHALL be rendered above the list

### Requirement: Real-time case-insensitive substring filtering
As the user types in the filter input, the dashboard list SHALL update immediately to show only dashboards whose names contain the filter string (case-insensitive substring match). No API call is made.

#### Scenario: Matching dashboards are shown
- **WHEN** the user types a string that matches the name of one or more dashboards (case-insensitively)
- **THEN** only those matching dashboards SHALL be visible in the list

#### Scenario: Non-matching dashboards are hidden
- **WHEN** the user types a string that does not match a dashboard's name
- **THEN** that dashboard SHALL NOT appear in the list (unless it is the active dashboard)

#### Scenario: Empty filter shows all dashboards
- **WHEN** the filter input is empty
- **THEN** all dashboards SHALL be displayed in the list

### Requirement: Active dashboard is always reachable regardless of filter
If the currently active (selected) dashboard does not match the filter string, it SHALL still appear in the list and SHALL be visually distinguished to indicate it is outside the current filter results.

#### Scenario: Active dashboard remains visible when filtered out
- **WHEN** the user types a filter string that does not match the active dashboard's name
- **THEN** the active dashboard SHALL still appear in the list
- **AND** it SHALL have a visual indicator (e.g., dimmed appearance or label) distinguishing it from matched results

#### Scenario: Active dashboard with no filter distinction
- **WHEN** the active dashboard name matches the current filter string
- **THEN** the active dashboard SHALL appear normally with no special styling

### Requirement: Clear button resets the filter
The filter input SHALL include a clear button (✕) that resets the filter to empty when clicked. The clear button SHALL only be visible when the filter input contains text.

#### Scenario: Clear button appears with filter text
- **WHEN** the filter input contains one or more characters
- **THEN** a clear button SHALL be visible adjacent to the input

#### Scenario: Clear button is hidden when filter is empty
- **WHEN** the filter input is empty
- **THEN** the clear button SHALL NOT be visible

#### Scenario: Clicking clear resets the filter
- **WHEN** the user clicks the clear button
- **THEN** the filter input SHALL be reset to empty
- **AND** all dashboards SHALL be displayed again

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


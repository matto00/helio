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

